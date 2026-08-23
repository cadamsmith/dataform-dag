import { describe, expect, it } from "vitest";
import type { SerializedGraph } from "@dataform-dag/core";
import {
  NODE_COLORS,
  downstreamOf,
  indexGraph,
  layoutGraph,
  upstreamOf,
} from "../src/graphToFlow.js";

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

describe("layoutGraph", () => {
  const flow = layoutGraph(graph);
  it("emits one positioned node per graph node, colored by type", () => {
    expect(flow.nodes).toHaveLength(3);
    const leaf = flow.nodes.find((n) => n.id === "leaf")!;
    expect(leaf.data.color).toBe(NODE_COLORS.table);
    expect(Number.isFinite(leaf.position.x)).toBe(true);
    expect(Number.isFinite(leaf.position.y)).toBe(true);
  });
  it("draws an edge per resolvable ref and drops refs to absent nodes", () => {
    expect(flow.edges.map((e) => e.id).sort()).toEqual(["mid->leaf", "src->mid"]);
    // leaf refs "missing", which has no node — no phantom edge.
    expect(flow.edges.some((e) => e.source === "missing" || e.target === "missing")).toBe(false);
  });
});

describe("index lookups", () => {
  const index = indexGraph(graph);
  it("upstream lists only refs that resolve to a node", () => {
    expect(upstreamOf(index, "leaf")).toEqual(["mid"]); // "missing" filtered out
    expect(upstreamOf(index, "src")).toEqual([]);
  });
  it("downstream reads the inverted map", () => {
    expect(downstreamOf(index, "src")).toEqual(["mid"]);
    expect(downstreamOf(index, "leaf")).toEqual([]);
  });
});
