import { describe, expect, it } from "vitest";
import type { DataformNode, NodeType } from "@dataform-dag/core";
import { CLUSTER_PREFIX, collapseAssertions, isClusterId } from "../src/collapseAssertions.js";
import type { UiGraph } from "../src/graphToFlow.js";

function node(id: string, type: NodeType, refs: string[] = []): DataformNode {
  return { id, type, refs, filePath: `def/${id}.sqlx`, tags: [] };
}

function graphOf(nodes: DataformNode[], downstream: Array<[string, string[]]> = []): UiGraph {
  return { nodes, downstream, issues: [] };
}

const ids = (graph: UiGraph): string[] => graph.nodes.map((n) => n.id);

describe("collapseAssertions", () => {
  it("collapses assertions that share a parent into one labelled node", () => {
    const { graph, members, clusterOf } = collapseAssertions(
      graphOf(
        [
          node("fct_obs", "table", ["stg_obs"]),
          node("assert_rows", "assertion", ["fct_obs"]),
          node("assert_unique", "assertion", ["fct_obs"]),
        ],
        [["fct_obs", ["assert_rows", "assert_unique"]]],
      ),
    );

    const cluster = graph.nodes.find((n) => isClusterId(n.id))!;
    expect(cluster.id).toBe(`${CLUSTER_PREFIX}fct_obs`);
    expect(cluster.label).toBe("2 assertions");
    expect(cluster.count).toBe(2);
    expect(cluster.type).toBe("assertion");
    expect(cluster.refs).toEqual(["fct_obs"]);
    expect(ids(graph)).toEqual(["fct_obs", `${CLUSTER_PREFIX}fct_obs`]);
    expect(members.get(cluster.id)!.map((m) => m.id)).toEqual(["assert_rows", "assert_unique"]);
    expect(clusterOf.get("assert_rows")).toBe(cluster.id);
  });

  it("dedupes the union of parents into the cluster's refs and id", () => {
    const { graph } = collapseAssertions(
      graphOf([
        node("a", "table"),
        node("b", "table"),
        node("assert_one", "assertion", ["a", "b"]),
        node("assert_two", "assertion", ["b", "a"]),
      ]),
    );

    const cluster = graph.nodes.find((n) => isClusterId(n.id))!;
    // One edge per parent: the layouts key edges as `${upstream}->${node.id}`, so a duplicated ref
    // would emit duplicate edge ids into ELK.
    expect(cluster.refs).toEqual(["a", "b"]);
    expect(cluster.id).toBe(`${CLUSTER_PREFIX}a+b`);
  });

  it("leaves assertions in different positions alone", () => {
    const before = graphOf([
      node("a", "table"),
      node("b", "table"),
      node("assert_a", "assertion", ["a"]),
      node("assert_b", "assertion", ["b"]),
    ]);
    const { graph, members } = collapseAssertions(before);
    expect(members.size).toBe(0);
    expect(ids(graph)).toEqual(ids(before));
  });

  it("leaves a lone assertion alone", () => {
    const { members } = collapseAssertions(
      graphOf([node("a", "table"), node("assert_a", "assertion", ["a"])]),
    );
    expect(members.size).toBe(0);
  });

  it("does not collapse assertions whose dependents differ", () => {
    const { members } = collapseAssertions(
      graphOf(
        [
          node("a", "table"),
          node("assert_one", "assertion", ["a"]),
          node("assert_two", "assertion", ["a"]),
          node("op_one", "operations", ["assert_one"]),
        ],
        [["assert_one", ["op_one"]]],
      ),
    );
    expect(members.size).toBe(0);
  });

  it("never collapses a group with no upstream — the tag filter can strip refs to nothing", () => {
    const { members } = collapseAssertions(
      graphOf([node("assert_one", "assertion"), node("assert_two", "assertion")]),
    );
    expect(members.size).toBe(0);
  });

  it("only collapses assertions, never other node types in the same position", () => {
    const { graph, members } = collapseAssertions(
      graphOf([
        node("src", "source"),
        node("stg_one", "view", ["src"]),
        node("stg_two", "view", ["src"]),
      ]),
    );
    expect(members.size).toBe(0);
    expect(ids(graph)).toEqual(["src", "stg_one", "stg_two"]);
  });

  it("rewrites the downstream map onto the cluster, without duplicates", () => {
    const { graph } = collapseAssertions(
      graphOf(
        [
          node("fct", "table"),
          node("assert_one", "assertion", ["fct"]),
          node("assert_two", "assertion", ["fct"]),
        ],
        [["fct", ["assert_one", "assert_two"]]],
      ),
    );
    expect(graph.downstream).toEqual([["fct", [`${CLUSTER_PREFIX}fct`]]]);
  });

  it("repoints a dependent's refs at the cluster so its edge survives", () => {
    // Both assertions feed the same operation, so they still share a position and collapse.
    const { graph } = collapseAssertions(
      graphOf(
        [
          node("fct", "table"),
          node("assert_one", "assertion", ["fct"]),
          node("assert_two", "assertion", ["fct"]),
          node("notify", "operations", ["assert_one", "assert_two"]),
        ],
        [
          ["fct", ["assert_one", "assert_two"]],
          ["assert_one", ["notify"]],
          ["assert_two", ["notify"]],
        ],
      ),
    );

    const cluster = `${CLUSTER_PREFIX}fct>notify`;
    const notify = graph.nodes.find((n) => n.id === "notify")!;
    expect(notify.refs).toEqual([cluster]);
    expect(graph.downstream).toEqual([
      ["fct", [cluster]],
      [cluster, ["notify"]],
    ]);
  });

  it("keeps two groups apart when they share parents but differ downstream", () => {
    // Same parent, but one pair are leaves and the other pair feed an operation. Keying the cluster
    // id on parents alone made the second group overwrite the first, and its assertions vanished
    // from both the canvas and the member list.
    const { graph, members, clusterOf } = collapseAssertions(
      graphOf(
        [
          node("fct", "table"),
          node("assert_leaf_one", "assertion", ["fct"]),
          node("assert_leaf_two", "assertion", ["fct"]),
          node("assert_fed_one", "assertion", ["fct"]),
          node("assert_fed_two", "assertion", ["fct"]),
          node("notify", "operations", ["assert_fed_one", "assert_fed_two"]),
        ],
        [
          ["fct", ["assert_leaf_one", "assert_leaf_two", "assert_fed_one", "assert_fed_two"]],
          ["assert_fed_one", ["notify"]],
          ["assert_fed_two", ["notify"]],
        ],
      ),
    );

    expect(members.size).toBe(2);
    expect(graph.nodes.filter((n) => isClusterId(n.id))).toHaveLength(2);
    // No assertion is lost: every member is still reachable through some cluster.
    expect([...members.values()].flat().map((m) => m.id).sort()).toEqual([
      "assert_fed_one",
      "assert_fed_two",
      "assert_leaf_one",
      "assert_leaf_two",
    ]);
    expect(new Set(clusterOf.values()).size).toBe(2);
  });

  it("keeps the cluster in the slot of its first member", () => {
    const { graph } = collapseAssertions(
      graphOf([
        node("a", "table"),
        node("assert_one", "assertion", ["a"]),
        node("assert_two", "assertion", ["a"]),
        node("z", "table", ["a"]),
      ]),
    );
    expect(ids(graph)).toEqual(["a", `${CLUSTER_PREFIX}a`, "z"]);
  });

  it("honours a higher minimum group size", () => {
    const nodes = [
      node("a", "table"),
      node("assert_one", "assertion", ["a"]),
      node("assert_two", "assertion", ["a"]),
    ];
    expect(collapseAssertions(graphOf(nodes), 3).members.size).toBe(0);
    expect(collapseAssertions(graphOf(nodes), 2).members.size).toBe(1);
  });

  it("unions member tags onto the cluster so a tag filter still describes it", () => {
    const withTags = (id: string, tags: string[]): DataformNode => ({
      ...node(id, "assertion", ["a"]),
      tags,
    });
    const { graph } = collapseAssertions(
      graphOf([node("a", "table"), withTags("assert_one", ["dq"]), withTags("assert_two", ["dq", "nightly"])]),
    );
    const cluster = graph.nodes.find((n) => isClusterId(n.id))!;
    expect(cluster.tags).toEqual(["dq", "nightly"]);
  });
});
