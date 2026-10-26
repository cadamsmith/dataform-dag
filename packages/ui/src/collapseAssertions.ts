import type { DataformNode } from "@dataform-dag/core";
import type { UiGraph, UiNode } from "./graphToFlow.js";

/**
 * Prefix for a synthetic cluster's id. `:` and `+` cannot appear in a Dataform target name
 * (`[A-Za-z0-9_]`), so a cluster id can never collide with a real node's id.
 */
export const CLUSTER_PREFIX = "assertions:";

export function isClusterId(id: string): boolean {
  return id.startsWith(CLUSTER_PREFIX);
}

export interface CollapsedGraph {
  /** The graph to lay out: members replaced by one cluster node each. */
  graph: UiGraph;
  /** clusterId to the real assertions it stands for, in display order. */
  members: Map<string, DataformNode[]>;
  /** memberId to clusterId, for remapping a selection/focus/search hit onto the canvas. */
  clusterOf: Map<string, string>;
}

/**
 * Collapse assertions that occupy the same position in the graph into one node per position.
 *
 * "Same position" means an identical upstream ref-set AND an identical downstream set — not
 * identical layout coordinates, which are an output of this and would make the grouping unstable.
 * In practice an assertion has no dependents, so this reads as "every assertion hanging off the same
 * parents becomes one node": the shape a compiled Dataform graph explodes into, where each model
 * with inline `config.assertions` contributes several leaf nodes that all say the same thing about
 * the layout.
 *
 * Pure, and composes after {@link filterGraphByTags} — the tag filter strips refs to nodes it
 * dropped, which is exactly why a group with NO upstream is never collapsed: two unrelated
 * assertions whose parents were both filtered out would otherwise merge into one meaningless node.
 */
export function collapseAssertions(graph: UiGraph, minGroupSize = 2): CollapsedGraph {
  const downstreamOf = new Map(graph.downstream);
  const groups = new Map<string, Group>();

  for (const node of graph.nodes) {
    if (node.type !== "assertion") continue;
    const upstream = sortedUnique(node.refs);
    // A group with no upstream has no position to share — see the doc comment.
    if (upstream.length === 0) continue;
    const downstream = sortedUnique(downstreamOf.get(node.id) ?? []);
    const group = groups.get(positionKey(upstream, downstream));
    if (group) group.nodes.push(node);
    else groups.set(positionKey(upstream, downstream), { upstream, downstream, nodes: [node] });
  }

  const clusterOf = new Map<string, string>();
  const members = new Map<string, DataformNode[]>();
  for (const group of groups.values()) {
    if (group.nodes.length < minGroupSize) continue;
    const id = clusterId(group);
    members.set(id, [...group.nodes].sort((a, b) => a.id.localeCompare(b.id)));
    for (const member of group.nodes) clusterOf.set(member.id, id);
  }
  if (members.size === 0) return { graph, members, clusterOf };

  // Rebuild in the original node order, with each cluster taking the slot of its first member: dagre
  // breaks ties by insertion order, so preserving it keeps the layout recognizable.
  const emitted = new Set<string>();
  const nodes: UiNode[] = [];
  for (const node of graph.nodes) {
    const clusterId = clusterOf.get(node.id);
    if (!clusterId) {
      nodes.push({ ...node, refs: remapRefs(node.refs, clusterOf) });
      continue;
    }
    if (emitted.has(clusterId)) continue;
    emitted.add(clusterId);
    nodes.push(clusterNode(clusterId, members.get(clusterId)!, clusterOf));
  }

  return {
    graph: { ...graph, nodes, downstream: remapDownstream(graph.downstream, clusterOf) },
    members,
    clusterOf,
  };
}

interface Group {
  upstream: string[];
  downstream: string[];
  nodes: DataformNode[];
}

/** Identical positions collapse together, so the position IS the group key. */
function positionKey(upstream: string[], downstream: string[]): string {
  return `${upstream.join("|")} => ${downstream.join("|")}`;
}

/**
 * A cluster's id must encode the WHOLE position, dependents included. Keying it on parents alone
 * collides two groups that share parents but differ downstream, and the second one silently
 * overwrites the first — its assertions would then be mapped to a cluster that never renders them.
 */
function clusterId({ upstream, downstream }: Group): string {
  const base = `${CLUSTER_PREFIX}${upstream.join("+")}`;
  return downstream.length > 0 ? `${base}>${downstream.join("+")}` : base;
}

/**
 * The stand-in node. It is a real graph node in every way the layout cares about — its `refs` are
 * its members' shared parents (remapped, in case a parent is itself collapsed), so it inherits their
 * edges without emitting duplicate edge ids — but it has no file of its own: only its members do,
 * and the detail panel offers those.
 */
function clusterNode(id: string, members: DataformNode[], clusterOf: Map<string, string>): UiNode {
  return {
    id,
    label: `${members.length} assertions`,
    count: members.length,
    filePath: "",
    type: "assertion",
    tags: sortedUnique(members.flatMap((m) => m.tags)),
    refs: remapRefs(sortedUnique(members.flatMap((m) => m.refs)), clusterOf),
  };
}

/** Point refs at clusters instead of collapsed members, so an edge into one is never dropped. */
function remapRefs(refs: string[], clusterOf: Map<string, string>): string[] {
  return unique(refs.map((r) => clusterOf.get(r) ?? r));
}

function remapDownstream(
  downstream: Array<[string, string[]]>,
  clusterOf: Map<string, string>,
): Array<[string, string[]]> {
  const merged = new Map<string, string[]>();
  for (const [id, dependents] of downstream) {
    const key = clusterOf.get(id) ?? id;
    merged.set(key, [...(merged.get(key) ?? []), ...remapRefs(dependents, clusterOf)]);
  }
  return [...merged]
    .map(([id, dependents]): [string, string[]] => [id, unique(dependents)])
    .filter(([, dependents]) => dependents.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sortedUnique(values: string[]): string[] {
  return unique(values).sort();
}
