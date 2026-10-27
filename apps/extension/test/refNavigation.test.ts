import { beforeEach, describe, expect, it } from "vitest";
import type { SerializedGraph } from "@dataform-dag/core";
import { RefNavigation, lensOffset } from "../src/refNavigation.js";
import type { GraphStore } from "../src/graphStore.js";
import { EventEmitter, Position, makeDocument, resetMock, workspace } from "./mocks/vscode.js";

const GRAPH: SerializedGraph = {
  nodes: [
    { id: "raw", filePath: "/p/definitions/raw.sqlx", type: "source", tags: [], refs: [] },
    {
      id: "orders",
      filePath: "/p/definitions/orders.sqlx",
      type: "table",
      tags: [],
      refs: ["raw"],
      description: "One row per order.",
    },
    { id: "orders_assertions_rowConditions", filePath: "/p/definitions/orders.sqlx", type: "assertion", tags: [], refs: ["orders"] },
    { id: "v1", filePath: "/p/definitions/views.js", type: "view", tags: [], refs: ["orders"] },
    { id: "v2", filePath: "/p/definitions/views.js", type: "view", tags: [], refs: ["orders"] },
  ],
  downstream: [
    ["raw", ["orders"]],
    ["orders", ["orders_assertions_rowConditions", "v1", "v2"]],
  ],
  issues: [],
};

const ORDERS = `config {\n  type: "table",\n}\n\nSELECT * FROM \${ref("raw")}\n`;
const VIEWS = `publish("v1").query(ctx => \`SELECT 1\`);\n\npublish("v2", { type: "view" });\n`;

function fakeStore(graph: SerializedGraph | undefined) {
  const emitter = new EventEmitter<SerializedGraph>();
  return {
    current: graph,
    onDidChangeGraph: emitter.event,
    workspaceRoot: () => "/p",
  } as unknown as GraphStore;
}

beforeEach(() => resetMock());

describe("RefNavigation", () => {
  it("jumps from a ref() to the referenced action's file", async () => {
    const nav = new RefNavigation(fakeStore(GRAPH));
    const doc = makeDocument("/p/definitions/orders.sqlx", ORDERS);
    const links = await nav.provideDefinition(doc as never, doc.positionAt(ORDERS.indexOf("raw\"")) as never);
    expect(links).toHaveLength(1);
    expect(links![0]!.targetUri.fsPath).toBe("/p/definitions/raw.sqlx");
    // The whole call is underlined as the link.
    expect(links![0]!.originSelectionRange!.start).toEqual(doc.positionAt(ORDERS.indexOf("ref(")));
  });

  it("lands on the line that declares a JS-defined action", async () => {
    workspace.documents.set("/p/definitions/views.js", makeDocument("/p/definitions/views.js", VIEWS));
    const nav = new RefNavigation(fakeStore(GRAPH));
    const text = `SELECT * FROM \${ref("v2")}`;
    const doc = makeDocument("/p/definitions/report.sqlx", text);
    const links = await nav.provideDefinition(doc as never, doc.positionAt(text.indexOf("v2")) as never);
    expect(links![0]!.targetRange.start).toEqual(new Position(2, 0));
  });

  it("answers nothing before the first compile, or for an unknown name", async () => {
    const doc = makeDocument("/p/definitions/orders.sqlx", ORDERS);
    const at = doc.positionAt(ORDERS.indexOf("raw\""));
    expect(await new RefNavigation(fakeStore(undefined)).provideDefinition(doc as never, at as never)).toBeUndefined();
    const other = `\${ref("missing")}`;
    const doc2 = makeDocument("/p/definitions/x.sqlx", other);
    expect(
      await new RefNavigation(fakeStore(GRAPH)).provideDefinition(doc2 as never, doc2.positionAt(8) as never),
    ).toBeUndefined();
  });

  it("describes the referenced action on hover", () => {
    const nav = new RefNavigation(fakeStore(GRAPH));
    const text = `\${ref("orders")}`;
    const doc = makeDocument("/p/definitions/x.sqlx", text);
    const hover = nav.provideHover(doc as never, doc.positionAt(8) as never);
    expect(hover!.contents.value).toBe(
      "**orders** · table\n\nOne row per order.\n\n1 upstream · 3 downstream · `definitions/orders.sqlx`",
    );
  });

  it("puts one lens over a .sqlx's config block, for the action the file is", () => {
    const nav = new RefNavigation(fakeStore(GRAPH));
    const lenses = nav.provideCodeLenses(makeDocument("/p/definitions/orders.sqlx", ORDERS) as never);
    expect(lenses).toHaveLength(1);
    expect(lenses[0]!.range.start).toEqual(new Position(0, 0));
    expect(lenses[0]!.command).toMatchObject({
      title: "$(arrow-up) 1 upstream · $(arrow-down) 3 downstream",
      command: "dataformDag.focusInGraph",
      arguments: [{ kind: "node", node: GRAPH.nodes[1] }],
    });
  });

  it("puts a named lens over each action a .js file publishes", () => {
    const nav = new RefNavigation(fakeStore(GRAPH));
    const lenses = nav.provideCodeLenses(makeDocument("/p/definitions/views.js", VIEWS) as never);
    expect(lenses.map((l) => [l.range.start.line, l.command!.title.split(":")[0]])).toEqual([
      [0, "v1"],
      [2, "v2"],
    ]);
  });
});

describe("lensOffset", () => {
  it("finds an indented config block, and falls back to the top", () => {
    const node = GRAPH.nodes[1]!;
    expect(lensOffset("-- header\n  config {", node)).toBe(12);
    expect(lensOffset("SELECT 1", node)).toBe(0);
  });
});
