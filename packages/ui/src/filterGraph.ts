import type { SerializedGraph } from "@dataform-dag/core";

/** Every tag present in the graph, deduped, for the filter's option list. */
export function allTags(graph: SerializedGraph): string[] {
  const out = new Set<string>();
  for (const node of graph.nodes) for (const tag of node.tags) out.add(tag);
  return [...out];
}

/**
 * Narrow the graph to nodes carrying ANY of `selectedTags` — OR semantics, matching how Dataform's
 * own `--tags` selection works. Edges whose other end didn't survive are dropped so the layout never
 * points at a node that isn't rendered.
 *
 * `issues` passes through untouched by design: diagnostics describe the WHOLE project, and
 * recomputing them here would report every filtered-out dependency as an unresolved reference.
 */
export function filterGraphByTags(
  graph: SerializedGraph,
  selectedTags: string[],
): SerializedGraph {
  if (selectedTags.length === 0) return graph;
  const wanted = new Set(selectedTags);
  const kept = graph.nodes.filter((node) => node.tags.some((tag) => wanted.has(tag)));
  const present = new Set(kept.map((node) => node.id));
  return {
    nodes: kept.map((node) => ({ ...node, refs: node.refs.filter((r) => present.has(r)) })),
    downstream: graph.downstream
      .filter(([id]) => present.has(id))
      .map(([id, ids]): [string, string[]] => [id, ids.filter((d) => present.has(d))])
      .filter(([, ids]) => ids.length > 0),
    issues: graph.issues,
  };
}
