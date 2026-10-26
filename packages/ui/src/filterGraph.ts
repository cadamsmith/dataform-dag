import type { SerializedGraph } from "@dataform-dag/core";

/** Every tag present in the graph, deduped, for the filter's option list. */
export function allTags(graph: SerializedGraph): string[] {
  const out = new Set<string>();
  for (const node of graph.nodes) for (const tag of node.tags) out.add(tag);
  return [...out];
}

/** How many nodes carry each tag, for the filter's per-tag counts. */
export function tagCounts(graph: SerializedGraph): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of graph.nodes) for (const tag of node.tags) out.set(tag, (out.get(tag) ?? 0) + 1);
  return out;
}

/**
 * Narrow the graph to nodes carrying ANY of `selectedTags` — OR semantics, matching how Dataform's
 * own `--tags` selection works. Edges whose other end didn't survive are dropped so the layout never
 * points at a node that isn't rendered.
 *
 * `issues` passes through untouched by design: diagnostics describe the WHOLE project, not the
 * filtered slice of it.
 */
export function filterGraphByTags(
  graph: SerializedGraph,
  selectedTags: string[],
): SerializedGraph {
  if (selectedTags.length === 0) return graph;
  const wanted = new Set(selectedTags);
  return restrictGraph(
    graph,
    new Set(graph.nodes.filter((node) => node.tags.some((tag) => wanted.has(tag))).map((n) => n.id)),
  );
}

/**
 * The subgraph of the nodes in `keep`. Refs and downstream entries pointing at a dropped node go
 * too, so the layout never draws an edge to something that isn't rendered. `issues` passes through:
 * diagnostics describe the whole project, not the slice on screen.
 */
export function restrictGraph(graph: SerializedGraph, keep: Set<string>): SerializedGraph {
  return {
    nodes: graph.nodes
      .filter((node) => keep.has(node.id))
      .map((node) => ({ ...node, refs: node.refs.filter((r) => keep.has(r)) })),
    downstream: graph.downstream
      .filter(([id]) => keep.has(id))
      .map(([id, ids]): [string, string[]] => [id, ids.filter((d) => keep.has(d))])
      .filter(([, ids]) => ids.length > 0),
    issues: graph.issues,
  };
}
