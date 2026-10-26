import { describe, expect, it } from "vitest";
import type { DataformNode, SerializedGraph } from "@dataform-dag/core";
import { lineageOf } from "../src/lineage.js";
import { restrictGraph } from "../src/filterGraph.js";

/**
 *   src ─▶ stg ─▶ fct ─▶ agg ─▶ report
 *                  │
 *                  ├─▶ assert_a
 *                  └─▶ assert_b
 *   other ─▶ stg2 (unrelated)
 */
function graphOf(edges: Array<[string, string]>, ...lone: string[]): SerializedGraph {
  const ids = new Set([...edges.flat(), ...lone]);
  const nodes: DataformNode[] = [...ids].map((id) => ({
    id,
    filePath: `${id}.sqlx`,
    type: id.startsWith("assert") ? "assertion" : "table",
    tags: [],
    refs: edges.filter(([, to]) => to === id).map(([from]) => from),
  }));
  const downstream = new Map<string, string[]>();
  for (const [from, to] of edges) downstream.set(from, [...(downstream.get(from) ?? []), to]);
  return { nodes, downstream: [...downstream], issues: [] };
}

const graph = graphOf([
  ["src", "stg"],
  ["stg", "fct"],
  ["fct", "agg"],
  ["agg", "report"],
  ["fct", "assert_a"],
  ["fct", "assert_b"],
  ["other", "stg2"],
]);

const sorted = (s: Set<string>) => [...s].sort();

describe("lineageOf", () => {
  it("keeps every ancestor and every descendant, and nothing unrelated", () => {
    const l = lineageOf(graph, ["stg"], null);
    expect(sorted(l.keep)).toEqual(["agg", "assert_a", "assert_b", "fct", "report", "src", "stg"]);
    expect(l.upstream).toBe(1);
    expect(l.downstream).toBe(5);
    expect(l.hops).toBe(3);
  });

  it("limits each direction to the given number of hops", () => {
    expect(sorted(lineageOf(graph, ["fct"], 1).keep)).toEqual([
      "agg",
      "assert_a",
      "assert_b",
      "fct",
      "stg",
    ]);
    expect(sorted(lineageOf(graph, ["fct"], 2).keep)).toEqual([
      "agg",
      "assert_a",
      "assert_b",
      "fct",
      "report",
      "src",
      "stg",
    ]);
  });

  it("leaves out siblings: another dependent of the parent is neither up- nor downstream", () => {
    const l = lineageOf(graph, ["assert_a"], null);
    expect(sorted(l.keep)).toEqual(["assert_a", "fct", "src", "stg"]);
    expect(l.downstream).toBe(0);
  });

  it("takes several roots, as a focused assertion cluster does", () => {
    const l = lineageOf(graph, ["assert_a", "assert_b"], null);
    expect(sorted(l.keep)).toEqual(["assert_a", "assert_b", "fct", "src", "stg"]);
    expect(l.upstream).toBe(3);
  });

  it("ignores a root that isn't in the graph", () => {
    expect(sorted(lineageOf(graph, ["gone"], null).keep)).toEqual([]);
  });
});

describe("restrictGraph", () => {
  it("drops refs and downstream entries that point outside the kept set", () => {
    const sub = restrictGraph(graph, new Set(["stg", "fct", "agg"]));
    expect(sub.nodes.map((n) => [n.id, n.refs])).toEqual([
      ["stg", []],
      ["fct", ["stg"]],
      ["agg", ["fct"]],
    ]);
    expect(sub.downstream).toEqual([
      ["stg", ["fct"]],
      ["fct", ["agg"]],
    ]);
  });
});
