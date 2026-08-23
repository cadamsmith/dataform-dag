/**
 * Browser-safe surface of the core. Re-exports only the pure parser + graph pieces — nothing here
 * pulls `node:fs` or `node:child_process`, so it bundles (and tree-shakes) cleanly for the web host.
 * The Node-only sources (`NodeFileSource`, `CompiledGraphSource`, `buildGraphFromWorkspace`) live
 * behind the package's main entry and are deliberately absent; a browser host supplies its own
 * {@link FileSource} and drives `parseSqlx` + `buildGraph` itself.
 */
export type {
  NodeType,
  DataformNode,
  DataformGraph,
  SerializedGraph,
  GraphIssue,
} from "./types.js";
export type { FileSource } from "./fileSource.js";
export { parseSqlx, extractRefs, extractConfigBlock, basename } from "./parser.js";
export {
  buildGraph,
  getAncestors,
  getDescendants,
  serializeGraph,
  deserializeGraph,
} from "./graph.js";
