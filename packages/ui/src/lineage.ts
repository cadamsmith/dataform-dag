import type { SerializedGraph } from "@dataform-dag/core";

export interface Lineage {
  /** The roots plus every node reached from them. */
  keep: Set<string>;
  /** Nodes reached walking up through `refs` (what the roots depend on), roots excluded. */
  upstream: number;
  /** Nodes reached walking down through dependents, roots excluded. */
  downstream: number;
  /** The most hops either walk took, so a depth limit knows where "everything" begins. */
  hops: number;
}

/**
 * Everything the roots depend on and everything that depends on them, out to `depth` hops each way
 * (`null` = no limit). It walks up and down separately, so a sibling (another dependent of the
 * root's parent) is never included: it is neither upstream nor downstream of the root.
 *
 * Several roots are allowed so an assertion cluster can be focused as a whole.
 */
export function lineageOf(
  graph: SerializedGraph,
  rootIds: string[],
  depth: number | null,
): Lineage {
  const { roots, up, down } = walkBoth(graph, rootIds, depth);
  return {
    keep: new Set([...roots, ...up.reached, ...down.reached]),
    upstream: up.reached.size,
    downstream: down.reached.size,
    hops: Math.max(up.hops, down.hops),
  };
}

/**
 * Focus mode under a tag filter: the lineage is walked on the WHOLE graph, then cut back to what
 * the filter shows, plus the roots, plus every hidden node linking a shown one to a root. Walking
 * the filtered graph instead lost anything reached only through an untagged node (src ─▶ stg ─▶ fct
 * with only src and fct tagged: fct's lineage stopped at fct). `bridges` names those linking nodes,
 * so the canvas can draw them as context rather than as matches. `shown` null means no filter.
 */
export function lineageThrough(
  graph: SerializedGraph,
  rootIds: string[],
  depth: number | null,
  shown: ReadonlySet<string> | null,
): Lineage & { bridges: Set<string> } {
  if (!shown) return { ...lineageOf(graph, rootIds, depth), bridges: new Set() };
  const { roots, up, down, refsOf, dependentsOf } = walkBoth(graph, rootIds, depth);
  const upKept = linking(up.reached, (id) => refsOf.get(id) ?? [], shown);
  const downKept = linking(down.reached, (id) => dependentsOf.get(id) ?? [], shown);
  const bridges = new Set([...upKept, ...downKept].filter((id) => !shown.has(id)));
  return {
    keep: new Set([...roots, ...upKept, ...downKept]),
    upstream: upKept.size,
    downstream: downKept.size,
    hops: Math.max(up.hops, down.hops),
    bridges,
  };
}

/**
 * The nodes of one side of a lineage worth drawing under a filter: those the filter shows, and
 * those with a shown node further out along `next` (so they sit between it and the root).
 */
function linking(
  reached: Set<string>,
  next: (id: string) => string[],
  shown: ReadonlySet<string>,
): Set<string> {
  const leads = new Map<string, boolean>();
  const leadsOut = (id: string): boolean => {
    const known = leads.get(id);
    if (known !== undefined) return known;
    leads.set(id, false); // a cycle (an invalid project) must not recurse forever
    const result = next(id).some((n) => reached.has(n) && (shown.has(n) || leadsOut(n)));
    leads.set(id, result);
    return result;
  };
  return new Set([...reached].filter((id) => shown.has(id) || leadsOut(id)));
}

function walkBoth(graph: SerializedGraph, rootIds: string[], depth: number | null) {
  const refsOf = new Map(graph.nodes.map((n) => [n.id, n.refs]));
  const dependentsOf = new Map(graph.downstream);
  const roots = new Set(rootIds.filter((id) => refsOf.has(id)));
  const up = walk(roots, (id) => refsOf.get(id) ?? [], depth);
  const down = walk(roots, (id) => dependentsOf.get(id) ?? [], depth);
  return { roots, up, down, refsOf, dependentsOf };
}

/**
 * Breadth-first from `roots` along `next`, out to `depth` hops. Returns what it reached (roots
 * excluded) and how many hops actually found something.
 */
function walk(
  roots: Set<string>,
  next: (id: string) => string[],
  depth: number | null,
): { reached: Set<string>; hops: number } {
  const reached = new Set<string>();
  let frontier = [...roots];
  let hops = 0;
  for (; frontier.length > 0 && (depth === null || hops < depth); hops++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      for (const n of next(id)) {
        if (roots.has(n) || reached.has(n)) continue;
        reached.add(n);
        nextFrontier.push(n);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }
  return { reached, hops };
}

/**
 * The deepest hop limit whose lineage stays within `limit` nodes (never less than 1), or null when
 * the whole lineage already fits. A shared core table's full lineage is most of a big project, so
 * focusing on it unbounded would just redraw everything.
 */
export function depthWithin(
  graph: SerializedGraph,
  rootIds: string[],
  limit: number,
): number | null {
  const all = lineageOf(graph, rootIds, null);
  if (all.keep.size <= limit) return null;
  let depth = 1;
  for (let d = 2; d < all.hops; d++) {
    if (lineageOf(graph, rootIds, d).keep.size > limit) break;
    depth = d;
  }
  return depth;
}
