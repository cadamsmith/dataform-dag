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
  const refsOf = new Map(graph.nodes.map((n) => [n.id, n.refs]));
  const dependentsOf = new Map(graph.downstream);
  const roots = new Set(rootIds.filter((id) => refsOf.has(id)));
  const up = walk(roots, (id) => refsOf.get(id) ?? [], depth);
  const down = walk(roots, (id) => dependentsOf.get(id) ?? [], depth);
  return {
    keep: new Set([...roots, ...up.reached, ...down.reached]),
    upstream: up.reached.size,
    downstream: down.reached.size,
    hops: Math.max(up.hops, down.hops),
  };
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
