/**
 * The node types dataform-dag renders. Dataform's own `config.type` values map onto these:
 * `declaration` becomes `source`; everything else passes through. `view` is the default when a
 * file declares no type (matching Dataform's own default for a plain SELECT).
 */
export type NodeType =
  | "table"
  | "view"
  | "incremental"
  | "assertion"
  | "operations"
  | "source";

/**
 * One node in the dependency graph — a single Dataform action. `id` is the target NAME
 * (`config.name` when present, else the filename without `.sqlx`), which is what `ref()` resolves
 * against; keying by basename alone would detach any declaration that renames itself (e.g. a file
 * `raw_fare_snapshots.sqlx` declaring `name: "fare_snapshots"`).
 */
export interface DataformNode {
  id: string;
  filePath: string;
  type: NodeType;
  tags: string[];
  refs: string[];
  description?: string;
}

/**
 * A problem found while building the graph. These are advisory, not fatal: the graph is still
 * usable, and in the parsed tier an "unresolved" reference is often just a ref the regex parser
 * can't follow (a JS-generated action) rather than a genuine mistake in the project.
 */
export type GraphIssue =
  | { kind: "unresolved-reference"; nodeId: string; filePath: string; reference: string }
  | { kind: "duplicate-node-id"; nodeId: string; filePaths: string[] };

/**
 * An immutable dependency graph. `downstreamMap` is derived once at build time: it inverts each
 * node's `refs` so descendant traversal is O(edges) instead of a full rescan.
 */
export interface DataformGraph {
  nodes: Map<string, DataformNode>;
  downstreamMap: Map<string, Set<string>>;
  issues: GraphIssue[];
}

/** Wire form of {@link DataformGraph} — Maps/Sets flattened so it survives JSON / postMessage. */
export interface SerializedGraph {
  nodes: DataformNode[];
  downstream: Array<[string, string[]]>;
  issues: GraphIssue[];
}
