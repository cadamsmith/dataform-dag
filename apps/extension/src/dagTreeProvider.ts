import * as path from "node:path";
import * as vscode from "vscode";
import type { DataformNode, NodeType } from "@dataform-dag/core";
import type { GraphStore } from "./graphStore.js";

/**
 * Group order, matching the canvas legend so the tree reads top-to-bottom the way the legend reads
 * left-to-right. Sources first is also the dependency order people narrate a DAG in.
 */
const TYPE_ORDER: readonly NodeType[] = [
  "source",
  "table",
  "view",
  "incremental",
  "assertion",
  "operations",
];

/** Codicon per node type — the tree's only visual vocabulary, since it can't use the graph colors. */
const TYPE_ICON: Record<NodeType, string> = {
  source: "database",
  table: "table",
  view: "eye",
  incremental: "diff-added",
  assertion: "check-all",
  operations: "gear",
};

/** Marks node rows for the `view/item/context` menu in package.json. */
export const NODE_CONTEXT_VALUE = "dataformDagNode";

/** How the tree's top level is organized; toggled from the view title bar. */
export type TreeGrouping = "type" | "folder";

export type TreeEntry =
  | { kind: "group"; type: NodeType; nodes: DataformNode[] }
  | {
      kind: "folder";
      /** Absolute directory path. */
      path: string;
      /** Path relative to its parent folder — several segments when a single-child chain is compacted. */
      label: string;
      folders: TreeEntry[];
      nodes: DataformNode[];
      /** Every action at or below this folder. */
      count: number;
    }
  | { kind: "node"; node: DataformNode };

/**
 * The activity-bar tree: every action in the project, grouped by type or by folder.
 *
 * Either way, rows are labelled by node id rather than filename: the target name (`config.name`),
 * which is what `ref()` resolves against and is often not the filename, schema-qualified when two
 * actions share it. That's what keeps the folder grouping from being a copy of the Explorer — a file
 * that yields several actions shows each of them.
 *
 * Reads {@link GraphStore.current} on every call rather than caching a graph of its own: the panel
 * and the tree must never disagree about what the project contains.
 */
export class DagTreeProvider implements vscode.TreeDataProvider<TreeEntry>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TreeEntry | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private grouping: TreeGrouping = "type";

  constructor(private readonly store: GraphStore) {
    this.subscriptions.push(
      store.onDidChangeGraph(() => this.changeEmitter.fire(undefined)),
      this.changeEmitter,
    );
  }

  setGrouping(grouping: TreeGrouping): void {
    if (grouping === this.grouping) return;
    this.grouping = grouping;
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
    if (entry.kind === "folder") {
      const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `folder:${entry.path}`;
      item.description = String(entry.count);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.resourceUri = vscode.Uri.file(entry.path);
      item.contextValue = "dataformDagFolder";
      return item;
    }
    if (entry.kind === "group") {
      const item = new vscode.TreeItem(entry.type, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${entry.type}`;
      item.description = String(entry.nodes.length);
      item.iconPath = new vscode.ThemeIcon(TYPE_ICON[entry.type]);
      item.contextValue = "dataformDagGroup";
      return item;
    }

    const { node } = entry;
    const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.None);
    // Identity is stated, not derived: entries are rebuilt on every getChildren, and a model and the
    // assertions generated from it share one resourceUri — target name is what
    // actually distinguishes those rows.
    item.id = `node:${node.id}`;
    // Tags are the one piece of metadata the file tree can't show, so they earn the description slot.
    item.description = node.tags.join(" ");
    item.tooltip = tooltipFor(node);
    item.iconPath = new vscode.ThemeIcon(TYPE_ICON[node.type]);
    item.contextValue = NODE_CONTEXT_VALUE;
    // Gives the row the editor's own file affordances (Reveal in Explorer, Copy Path) for free.
    item.resourceUri = vscode.Uri.file(node.filePath);
    item.command = {
      command: "dataformDag.revealNode",
      title: "Open Node",
      arguments: [entry],
    };
    return item;
  }

  async getChildren(entry?: TreeEntry): Promise<TreeEntry[]> {
    if (entry?.kind === "node") return [];
    if (entry?.kind === "group") return entry.nodes.map(nodeEntry);
    if (entry?.kind === "folder") return [...entry.folders, ...entry.nodes.map(nodeEntry)];

    // Opening the view can be the first thing that activates the extension, so build on demand.
    // A missing folder or a failed build leaves `current` undefined and the view falls through to
    // its `viewsWelcome` message rather than showing an empty tree.
    if (!this.store.current) await this.store.ensureGraph();
    const graph = this.store.current;
    if (!graph) return [];
    if (this.grouping === "folder") {
      return groupByFolder(graph.nodes, this.store.workspaceRoot() ?? commonDir(graph.nodes));
    }
    return groupByType(graph.nodes);
  }

  dispose(): void {
    for (const d of this.subscriptions.splice(0)) d.dispose();
  }
}

const nodeEntry = (node: DataformNode): TreeEntry => ({ kind: "node", node });
const byId = (a: DataformNode, b: DataformNode) => a.id.localeCompare(b.id);

function groupByType(nodes: readonly DataformNode[]): TreeEntry[] {
  const byType = new Map<NodeType, DataformNode[]>();
  for (const node of nodes) {
    const bucket = byType.get(node.type);
    if (bucket) bucket.push(node);
    else byType.set(node.type, [node]);
  }
  return TYPE_ORDER.filter((type) => byType.has(type)).map((type) => ({
    kind: "group",
    type,
    // The assertions Dataform synthesizes from a model share that model's
    // .sqlx, so several rows can point at one file. They are genuinely separate actions, so they
    // stay separate rows — clicking any of them opens the file they were generated from.
    nodes: [...byType.get(type)!].sort(byId),
  }));
}

interface FolderBuild {
  path: string;
  subfolders: Map<string, FolderBuild>;
  nodes: DataformNode[];
}

/**
 * Nest nodes by the directory their file lives in, relative to `root`. The root itself is not a row:
 * its subfolders are the top level, followed by any actions whose file sits directly in it.
 */
function groupByFolder(nodes: readonly DataformNode[], root: string): TreeEntry[] {
  const top: FolderBuild = { path: root, subfolders: new Map(), nodes: [] };
  for (const node of nodes) {
    const rel = path.relative(root, path.dirname(node.filePath));
    let folder = top;
    // A file outside the root (`..`) has nowhere sensible to nest, so it stays at the top level.
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      for (const segment of rel.split(path.sep)) {
        let next = folder.subfolders.get(segment);
        if (!next) {
          next = { path: path.join(folder.path, segment), subfolders: new Map(), nodes: [] };
          folder.subfolders.set(segment, next);
        }
        folder = next;
      }
    }
    folder.nodes.push(node);
  }
  return [...folderEntries(top), ...top.nodes.sort(byId).map(nodeEntry)];
}

function folderEntries(parent: FolderBuild): TreeEntry[] {
  return [...parent.subfolders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, folder]) => {
      // Compact a chain of folders that hold nothing but one subfolder (`definitions/staging`), the
      // way the Explorer does — otherwise most projects open with a lone `definitions` row on top.
      let label = segment;
      while (folder.nodes.length === 0 && folder.subfolders.size === 1) {
        const [childSegment, child] = folder.subfolders.entries().next().value!;
        label = `${label}/${childSegment}`;
        folder = child;
      }
      const folders = folderEntries(folder);
      const count =
        folder.nodes.length +
        folders.reduce((sum, f) => sum + (f.kind === "folder" ? f.count : 0), 0);
      return {
        kind: "folder",
        path: folder.path,
        label,
        folders,
        nodes: [...folder.nodes].sort(byId),
        count,
      };
    });
}

/** The deepest directory containing every node's file — the fallback root with no workspace. */
function commonDir(nodes: readonly DataformNode[]): string {
  const [first] = nodes;
  if (!first) return path.sep;
  let dir = path.dirname(first.filePath);
  for (const node of nodes) {
    while (dir !== path.dirname(dir) && path.relative(dir, node.filePath).startsWith("..")) {
      dir = path.dirname(dir);
    }
  }
  return dir;
}

function tooltipFor(node: DataformNode): vscode.MarkdownString {
  const lines = [`**${node.id}** · \`${node.type}\``, "", path.basename(node.filePath)];
  if (node.description) lines.push("", node.description);
  if (node.tags.length) lines.push("", `Tags: ${node.tags.join(", ")}`);
  if (node.refs.length) lines.push("", `Depends on: ${node.refs.join(", ")}`);
  return new vscode.MarkdownString(lines.join("\n"));
}
