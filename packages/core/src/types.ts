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
 * `raw_fare_snapshots.sqlx` declaring `name: "fare_snapshots"`). A name shared by two actions in
 * different schemas is qualified as `schema.name` for those nodes only.
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
 * usable. There is no "unresolved reference" kind: a compile with a missing dependency fails
 * outright, so a graph built from a successful one has every ref resolved.
 */
export type GraphIssue = { kind: "duplicate-node-id"; nodeId: string; filePaths: string[] };

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
