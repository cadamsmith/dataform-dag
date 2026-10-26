import type { DataformNode } from "@dataform-dag/core";
import type { UiGraph, UiNode } from "./graphToFlow.js";

/**
 * Prefix for a synthetic folder node's id. Like an assertion cluster's, it can't collide with a
 * Dataform target name (`[A-Za-z0-9_]`), and it MUST never be sent to a host.
 */
export const FOLDER_PREFIX = "folder:";

export function isFolderId(id: string): boolean {
  return id.startsWith(FOLDER_PREFIX);
}

export const folderId = (path: string): string => `${FOLDER_PREFIX}${path}`;
export const folderPathOf = (id: string): string => id.slice(FOLDER_PREFIX.length);

/**
 * The project's folder structure, built once from the UNFILTERED graph so that what a folder is (and
 * which folders are pass-throughs) doesn't shift as filters change.
 */
export interface FolderTree {
  /** Each node's folder, relative to the project root ("" for a file at the root). */
  folderOfNode: Map<string, string>;
  /**
   * Folders holding a single subfolder and no files of their own. They are never drawn: collapsed,
   * they would stand for exactly what their one child does, and expanding them is a wasted click.
   */
  passThrough: Set<string>;
  /** Whether there is anything to group: at least one node lives below the root. */
  hasFolders: boolean;
}

export function folderTree(nodes: Pick<DataformNode, "id" | "filePath">[]): FolderTree {
  // An action with no file of its own carries its target name as `filePath` (see core's `toNode`).
  // It has no folder, so it sits at the root, and must not drag the root up to wherever it resolves.
  const inFile = nodes.filter((n) => hasFile(n.filePath));
  const dirs = new Map(inFile.map((n) => [n.id, dirSegments(n.filePath)]));
  const root = commonPrefix([...dirs.values()]);
  const folderOfNode = new Map<string, string>(nodes.map((n) => [n.id, ""]));
  const subfolders = new Map<string, Set<string>>();
  const hasFiles = new Set<string>();
  for (const [id, segments] of dirs) {
    const rel = segments.slice(root.length);
    const path = rel.join("/");
    folderOfNode.set(id, path);
    hasFiles.add(path);
    for (let i = 1; i <= rel.length; i++) {
      const parent = rel.slice(0, i - 1).join("/");
      if (!subfolders.has(parent)) subfolders.set(parent, new Set());
      subfolders.get(parent)!.add(rel.slice(0, i).join("/"));
    }
  }
  const passThrough = new Set<string>();
  for (const [path, children] of subfolders) {
    if (path !== "" && children.size === 1 && !hasFiles.has(path)) passThrough.add(path);
  }
  return {
    folderOfNode,
    passThrough,
    hasFolders: [...folderOfNode.values()].some((p) => p !== ""),
  };
}

export interface FolderCollapse {
  /** The graph with each collapsed folder's nodes replaced by one folder node. */
  graph: UiGraph;
  /** Folder id to every real node inside it, at any depth, sorted by id. */
  members: Map<string, DataformNode[]>;
  /** Real node id to the collapsed folder hiding it. */
  folderOf: Map<string, string>;
}

/**
 * Collapse every folder that isn't in `expanded` into a single node, level by level: a node shows
 * through only when every folder above it is expanded, otherwise it is folded into the outermost
 * collapsed one. Edges between folders are the union of their members' edges.
 *
 * Pure, and runs after the filters (on what is actually shown) and BEFORE `collapseAssertions`,
 * so an assertion cluster only ever groups assertions that are drawn individually.
 */
export function collapseFolders(
  graph: UiGraph,
  tree: FolderTree,
  expanded: ReadonlySet<string>,
): FolderCollapse {
  const folderOf = new Map<string, string>();
  const members = new Map<string, DataformNode[]>();
  for (const node of graph.nodes) {
    const path = visibleFolder(tree.folderOfNode.get(node.id) ?? "", tree, expanded);
    if (path === null) continue;
    const id = folderId(path);
    folderOf.set(node.id, id);
    members.set(id, [...(members.get(id) ?? []), node]);
  }
  if (members.size === 0) return { graph, members, folderOf };

  // Each folder takes the slot of its first member: dagre breaks ties by insertion order.
  const remap = (refs: string[], self?: string) =>
    unique(refs.map((r) => folderOf.get(r) ?? r)).filter((r) => r !== self);
  const nodes: UiNode[] = [];
  for (const node of graph.nodes) {
    const id = folderOf.get(node.id);
    if (!id) {
      nodes.push({ ...node, refs: remap(node.refs) });
      continue;
    }
    if (members.get(id)![0] !== node) continue;
    const inside = members.get(id)!;
    nodes.push({
      id,
      label: `${folderPathOf(id)}/`,
      count: inside.length,
      folder: true,
      filePath: "",
      // Unused for drawing (a folder has its own look), but a UiNode needs one.
      type: "table",
      tags: unique(inside.flatMap((m) => m.tags)).sort(),
      refs: remap(
        inside.flatMap((m) => m.refs),
        id,
      ),
    });
  }
  for (const list of members.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const downstream = new Map<string, string[]>();
  for (const node of nodes) {
    for (const ref of node.refs) downstream.set(ref, [...(downstream.get(ref) ?? []), node.id]);
  }
  return { graph: { ...graph, nodes, downstream: [...downstream] }, members, folderOf };
}

/**
 * The outermost collapsed folder on the way down to `path`, or null when every folder on the way is
 * expanded (or a pass-through), so the node is drawn itself.
 */
export function visibleFolder(
  path: string,
  tree: FolderTree,
  expanded: ReadonlySet<string>,
): string | null {
  if (path === "") return null;
  const segments = path.split("/");
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    if (!expanded.has(prefix) && !tree.passThrough.has(prefix)) return prefix;
  }
  return null;
}

/** Every folder above and including `path`: what to expand so a node in `path` is drawn itself. */
export function ancestorsOf(path: string): string[] {
  if (path === "") return [];
  const segments = path.split("/");
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

/** A real source file has an extension (`.sqlx`, `.js`); a target-name stand-in doesn't. */
function hasFile(filePath: string): boolean {
  return /\.[^\\/.]+$/.test(filePath);
}

function dirSegments(filePath: string): string[] {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts;
}

function commonPrefix(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  let prefix = lists[0]!;
  for (const list of lists) {
    let i = 0;
    while (i < prefix.length && i < list.length && prefix[i] === list[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
