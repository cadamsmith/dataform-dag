import type { DataformGraph, DataformNode, GraphIssue, SerializedGraph } from "./types.js";

/**
 * Build the immutable graph from a flat node list. Edges come from each node's `refs`; the inverse
 * `downstreamMap` is computed once here. A ref to a name that has no node (an unresolved/external
 * dependency) is kept in the node's `refs` but seeds no downstream entry — traversal simply skips
 * nodes that aren't present, so a dangling ref never crashes and never invents a phantom node.
 * Those danglers, and any id claimed by more than one file, are reported in `issues`.
 */
export function buildGraph(nodes: DataformNode[]): DataformGraph {
  const nodeMap = new Map<string, DataformNode>();
  // Collect every file per id BEFORE populating nodeMap: `Map#set` silently overwrites, so a
  // collision is invisible by the time the map is built.
  const filesById = new Map<string, string[]>();
  for (const node of nodes) {
    const files = filesById.get(node.id);
    if (files) files.push(node.filePath);
    else filesById.set(node.id, [node.filePath]);
    nodeMap.set(node.id, node);
  }

  const issues: GraphIssue[] = [];
  // Node identity is the target name, so two actions sharing an id cannot both be represented —
  // one of them is unreachable in the rendered graph.
  for (const [nodeId, filePaths] of filesById) {
    if (filePaths.length > 1) issues.push({ kind: "duplicate-node-id", nodeId, filePaths });
  }

  const downstreamMap = new Map<string, Set<string>>();
  const seenUnresolved = new Set<string>();
  for (const node of nodes) {
    for (const upstream of node.refs) {
      if (!nodeMap.has(upstream)) {
        // One issue per (node, reference) pair — a ref repeated across the file body is one problem.
        const key = `${node.id}\u0000${upstream}`;
        if (!seenUnresolved.has(key)) {
          seenUnresolved.add(key);
          issues.push({
            kind: "unresolved-reference",
            nodeId: node.id,
            filePath: node.filePath,
            reference: upstream,
          });
        }
      }
      let set = downstreamMap.get(upstream);
      if (!set) {
        set = new Set<string>();
        downstreamMap.set(upstream, set);
      }
      set.add(node.id);
    }
  }
  return { nodes: nodeMap, downstreamMap, issues };
}

/** All transitive upstream dependencies of `nodeId` (things it depends on). Excludes `nodeId`. */
export function getAncestors(graph: DataformGraph, nodeId: string): Set<string> {
  return traverse(nodeId, (id) => graph.nodes.get(id)?.refs ?? [], graph.nodes);
}

/** All transitive downstream dependents of `nodeId` (things that depend on it). Excludes `nodeId`. */
export function getDescendants(graph: DataformGraph, nodeId: string): Set<string> {
  return traverse(nodeId, (id) => graph.downstreamMap.get(id), graph.nodes);
}

/** Breadth-first transitive closure from `start`, following `neighbors`. Cycle-safe; skips missing nodes. */
function traverse(
  start: string,
  neighbors: (id: string) => Iterable<string> | undefined,
  present: Map<string, DataformNode>,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of neighbors(current) ?? []) {
      if (next !== start && !result.has(next) && present.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
  }
  return result;
}

/** Flatten to the wire form so it survives `JSON.stringify` / `postMessage`. */
export function serializeGraph(graph: DataformGraph): SerializedGraph {
  return {
    nodes: [...graph.nodes.values()],
    downstream: [...graph.downstreamMap.entries()].map(([id, set]) => [id, [...set]]),
    issues: graph.issues,
  };
}

/** Inverse of {@link serializeGraph}. Rebuilds the Maps/Sets UI-side. */
export function deserializeGraph(s: SerializedGraph): DataformGraph {
  return {
    nodes: new Map(s.nodes.map((n) => [n.id, n])),
    downstreamMap: new Map(s.downstream.map(([id, ids]) => [id, new Set(ids)])),
    // Tolerate a payload from a host that predates diagnostics rather than yielding `undefined`.
    issues: s.issues ?? [],
  };
}
