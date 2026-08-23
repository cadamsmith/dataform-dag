import { describe, expect, it } from "vitest";
import type { FileSource } from "@dataform-dag/core/browser";
import type { InboundMsg } from "@dataform-dag/ui";
import { BrowserBridge } from "../src/BrowserBridge.js";

/** In-memory FileSource — the browser walk, replaced by a fixed set of .sqlx files. */
class FakeSource implements FileSource {
  constructor(private readonly files: Record<string, string>) {}
  listSqlx(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.files));
  }
  read(path: string): Promise<string> {
    return Promise.resolve(this.files[path] ?? "");
  }
}

/** Resolve with the next graphUpdate the bridge emits. */
function nextGraphUpdate(bridge: BrowserBridge): Promise<Extract<InboundMsg, { type: "graphUpdate" }>> {
  return new Promise((resolve) => {
    const off = bridge.onMessage((msg) => {
      if (msg.type === "graphUpdate") {
        off();
        resolve(msg);
      }
    });
  });
}

describe("BrowserBridge", () => {
  const source = new FakeSource({
    "definitions/a.sqlx": 'config { type: "table" }\nSELECT 1 AS x',
    // single quotes so ${ref(...)} is a literal, not a template interpolation
    "definitions/b.sqlx": 'config { type: "view" }\nSELECT * FROM ' + '${ref("a")}',
  });

  it("builds and emits the parsed graph on ready", async () => {
    const bridge = new BrowserBridge(source);
    const update = nextGraphUpdate(bridge);
    bridge.send({ type: "ready" });
    const { graph } = await update;

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(graph.nodes.find((n) => n.id === "b")?.refs).toEqual(["a"]);
    // downstream inverts refs: a → b
    expect(graph.downstream).toContainEqual(["a", ["b"]]);
  });

  it("rebuilds on requestRefresh too", async () => {
    const bridge = new BrowserBridge(source);
    const update = nextGraphUpdate(bridge);
    bridge.send({ type: "requestRefresh" });
    const { graph } = await update;
    expect(graph.nodes).toHaveLength(2);
  });

  it("declares no host capabilities (browser can't open/watch/focus/compile)", () => {
    expect(new BrowserBridge(source).capabilities).toEqual({
      openFile: false,
      compiledSql: false,
      compiledGraph: false,
      liveWatch: false,
      focusOnActive: false,
    });
  });
});
