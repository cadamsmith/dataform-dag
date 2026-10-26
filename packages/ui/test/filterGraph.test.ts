import { describe, expect, it } from "vitest";
import type { SerializedGraph } from "@dataform-dag/core";
import { allTags, filterGraphByTags, filterGraphWithContext } from "../src/filterGraph.js";

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "src.sqlx", type: "source", tags: ["raw"], refs: [] },
    { id: "mid", filePath: "mid.sqlx", type: "table", tags: ["core", "raw"], refs: ["src"] },
    { id: "leaf", filePath: "leaf.sqlx", type: "view", tags: ["mart"], refs: ["mid"] },
  ],
  downstream: [
    ["src", ["mid"]],
    ["mid", ["leaf"]],
  ],
  issues: [{ kind: "duplicate-node-id", nodeId: "src", filePaths: ["src.sqlx", "src_copy.sqlx"] }],
};

describe("allTags", () => {
  it("collects every tag once", () => {
    expect(allTags(graph).sort()).toEqual(["core", "mart", "raw"]);
  });

  it("is empty for an untagged graph", () => {
    expect(allTags({ nodes: [], downstream: [], issues: [] })).toEqual([]);
  });
});

describe("filterGraphByTags", () => {
  it("returns the same graph when nothing is selected", () => {
    expect(filterGraphByTags(graph, [])).toBe(graph);
  });

  it("keeps nodes carrying any selected tag (OR, not AND)", () => {
    const out = filterGraphByTags(graph, ["core", "mart"]);
    expect(out.nodes.map((n) => n.id)).toEqual(["mid", "leaf"]);
  });

  it("drops refs pointing at nodes the filter removed", () => {
    const out = filterGraphByTags(graph, ["core"]);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]?.refs).toEqual([]); // "src" was filtered out
  });

  it("drops downstream entries whose endpoints did not survive", () => {
    const out = filterGraphByTags(graph, ["mart"]);
    expect(out.downstream).toEqual([]);
  });

  it("keeps a downstream edge when both ends survive", () => {
    const out = filterGraphByTags(graph, ["raw", "mart"]);
    expect(out.downstream).toEqual([
      ["src", ["mid"]],
      ["mid", ["leaf"]],
    ]);
  });

  it("carries project-wide issues through untouched", () => {
    // Diagnostics describe the whole project, not the filtered slice.
    expect(filterGraphByTags(graph, ["mart"]).issues).toEqual(graph.issues);
  });

  it("does not mutate the input graph", () => {
    filterGraphByTags(graph, ["core"]);
    expect(graph.nodes[1]?.refs).toEqual(["src"]);
  });
});

describe("filterGraphWithContext", () => {
  // src ─▶ mid ─▶ leaf, tagged raw / core+raw / mart
  it("adds each match's direct neighbors, and names them as context", () => {
    const { graph: g, context } = filterGraphWithContext(graph, ["mart"], true);
    expect(g.nodes.map((n) => n.id)).toEqual(["mid", "leaf"]);
    expect([...context]).toEqual(["mid"]);
    // The neighbor keeps its edge to the match, and only that.
    expect(g.nodes.find((n) => n.id === "leaf")!.refs).toEqual(["mid"]);
    expect(g.nodes.find((n) => n.id === "mid")!.refs).toEqual([]);
  });

  it("goes one hop only", () => {
    const { graph: g } = filterGraphWithContext(graph, ["core"], true);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["leaf", "mid", "src"]);
    const { graph: g2, context } = filterGraphWithContext(
      { ...graph, nodes: graph.nodes.map((n) => (n.id === "mid" ? { ...n, tags: [] } : n)) },
      ["mart"],
      true,
    );
    expect(g2.nodes.map((n) => n.id)).toEqual(["mid", "leaf"]);
    expect(context.has("src")).toBe(false);
  });

  it("never calls a match context, even when it neighbors another match", () => {
    const { context } = filterGraphWithContext(graph, ["raw"], true);
    expect([...context]).toEqual(["leaf"]);
  });

  it("is the plain tag filter when off, or when no tag is selected", () => {
    expect(filterGraphWithContext(graph, ["mart"], false).graph).toEqual(filterGraphByTags(graph, ["mart"]));
    expect(filterGraphWithContext(graph, [], true).graph).toBe(graph);
    expect(filterGraphWithContext(graph, [], true).context.size).toBe(0);
  });
});
