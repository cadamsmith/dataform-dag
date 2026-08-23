import { describe, expect, it } from "vitest";
import type { SerializedGraph } from "@dataform-dag/core";
import { layoutGraphElk } from "../src/elkLayout.js";

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "src.sqlx", type: "source", tags: [], refs: [] },
    { id: "mid", filePath: "mid.sqlx", type: "incremental", tags: [], refs: ["src"] },
    { id: "leaf", filePath: "leaf.sqlx", type: "table", tags: [], refs: ["mid", "missing"] },
  ],
  downstream: [
    ["src", ["mid"]],
    ["mid", ["leaf"]],
  ],
  issues: [],
};

describe("layoutGraphElk", () => {
  it("positions every node and lays them left-to-right by rank", async () => {
    const flow = await layoutGraphElk(graph);
    expect(flow.nodes).toHaveLength(3);
    const x = (id: string) => flow.nodes.find((n) => n.id === id)!.position.x;
    for (const n of flow.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    // RIGHT direction: src is upstream of mid is upstream of leaf.
    expect(x("src")).toBeLessThan(x("mid"));
    expect(x("mid")).toBeLessThan(x("leaf"));
  });

  it("emits routed points per edge and drops refs to absent nodes", async () => {
    const flow = await layoutGraphElk(graph);
    expect(flow.edges.map((e) => e.id).sort()).toEqual(["mid->leaf", "src->mid"]);
    for (const e of flow.edges) {
      expect(e.points && e.points.length).toBeGreaterThanOrEqual(2); // start + end at minimum
    }
  });
});
