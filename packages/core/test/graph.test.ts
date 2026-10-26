import { describe, expect, it } from "vitest";
import {
  buildGraph,
  deserializeGraph,
  getAncestors,
  getDescendants,
  serializeGraph,
  type DataformNode,
} from "../src/index.js";

const node = (id: string, refs: string[] = [], type: DataformNode["type"] = "table"): DataformNode => ({
  id,
  filePath: `${id}.sqlx`,
  type,
  tags: [],
  refs,
});

// a -> b -> c  (c depends on b depends on a), plus d depends on b
const nodes = [node("a", [], "source"), node("b", ["a"]), node("c", ["b"]), node("d", ["b"])];

describe("buildGraph", () => {
  it("inverts refs into a downstream map", () => {
    const g = buildGraph(nodes);
    expect([...(g.downstreamMap.get("b") ?? [])].sort()).toEqual(["c", "d"]);
    expect(g.downstreamMap.get("c")).toBeUndefined();
  });

  it("keeps a dangling ref without inventing a phantom node", () => {
    const g = buildGraph([node("x", ["missing"])]);
    expect(g.nodes.has("missing")).toBe(false);
    expect(getAncestors(g, "x").size).toBe(0); // traversal skips absent targets
  });
});

describe("diagnostics", () => {
  it("reports no issues for a fully resolved graph", () => {
    expect(buildGraph(nodes).issues).toEqual([]);
  });

  it("does not report a dangling ref", () => {
    // A compile with a missing dependency fails outright, so there is no issue kind for one.
    expect(buildGraph([node("x", ["missing"])]).issues).toEqual([]);
  });

  it("reports an id claimed by more than one file", () => {
    const g = buildGraph([
      { id: "dup", filePath: "one.sqlx", type: "table", tags: [], refs: [] },
      { id: "dup", filePath: "two.sqlx", type: "view", tags: [], refs: [] },
    ]);
    expect(g.issues).toEqual([
      { kind: "duplicate-node-id", nodeId: "dup", filePaths: ["one.sqlx", "two.sqlx"] },
    ]);
    expect(g.nodes.size).toBe(1); // ...and only one of them is reachable
  });

  it("does not flag a unique id as duplicate", () => {
    const g = buildGraph([node("a"), node("b")]);
    expect(g.issues.filter((i) => i.kind === "duplicate-node-id")).toEqual([]);
  });
});

describe("traversal", () => {
  const g = buildGraph(nodes);
  it("collects transitive ancestors (upstream)", () => {
    expect([...getAncestors(g, "c")].sort()).toEqual(["a", "b"]);
  });
  it("collects transitive descendants (downstream)", () => {
    expect([...getDescendants(g, "a")].sort()).toEqual(["b", "c", "d"]);
  });
  it("is cycle-safe", () => {
    const cyclic = buildGraph([node("p", ["q"]), node("q", ["p"])]);
    expect([...getAncestors(cyclic, "p")].sort()).toEqual(["p", "q"].filter((x) => x !== "p"));
    expect(getDescendants(cyclic, "p").has("q")).toBe(true);
  });
});

describe("serialize round-trip", () => {
  it("survives serialize -> deserialize unchanged", () => {
    const g = buildGraph(nodes);
    const back = deserializeGraph(serializeGraph(g));
    expect([...back.nodes.keys()].sort()).toEqual([...g.nodes.keys()].sort());
    expect([...(back.downstreamMap.get("b") ?? [])].sort()).toEqual(["c", "d"]);
  });

  it("carries issues across the wire", () => {
    const g = buildGraph([node("x", ["missing"])]);
    const back = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(g))));
    expect(back.issues).toEqual(g.issues);
  });

  it("defaults issues to [] when the payload predates diagnostics", () => {
    const legacy = { nodes: [], downstream: [] } as unknown as ReturnType<typeof serializeGraph>;
    expect(deserializeGraph(legacy).issues).toEqual([]);
  });
});
