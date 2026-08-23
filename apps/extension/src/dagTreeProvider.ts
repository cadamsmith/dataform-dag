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

export type TreeEntry =
  | { kind: "group"; type: NodeType; nodes: DataformNode[] }
  | { kind: "node"; node: DataformNode };

/**
 * The activity-bar tree: every action in the project grouped by type.
 *
 * It deliberately answers a different question than the Explorer — "what kinds of actions exist and
 * what are they called" rather than "what files are on disk" — so it groups by {@link NodeType} and
 * labels rows by target name (`config.name`), which is what `ref()` resolves against and is often
 * not the filename.
 *
 * Reads {@link GraphStore.current} on every call rather than caching a graph of its own: the panel
 * and the tree must never disagree about what the project contains.
 */
export class DagTreeProvider implements vscode.TreeDataProvider<TreeEntry>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TreeEntry | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly store: GraphStore) {
    this.subscriptions.push(
      store.onDidChangeGraph(() => this.changeEmitter.fire(undefined)),
      this.changeEmitter,
    );
  }

  getTreeItem(entry: TreeEntry): vscode.TreeItem {
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
    // Identity is stated, not derived: entries are rebuilt on every getChildren, and in compiled mode
    // a model and the assertions generated from it share one resourceUri — target name is what
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
    if (entry?.kind === "group") return entry.nodes.map((node) => ({ kind: "node", node }));

    // Opening the view can be the first thing that activates the extension, so build on demand.
    // A missing folder or a failed build leaves `current` undefined and the view falls through to
    // its `viewsWelcome` message rather than showing an empty tree.
    if (!this.store.current) await this.store.ensureGraph();
    const graph = this.store.current;
    if (!graph) return [];

    const byType = new Map<NodeType, DataformNode[]>();
    for (const node of graph.nodes) {
      const bucket = byType.get(node.type);
      if (bucket) bucket.push(node);
      else byType.set(node.type, [node]);
    }
    return TYPE_ORDER.filter((type) => byType.has(type)).map((type) => ({
      kind: "group",
      type,
      // In compiled mode the assertions Dataform synthesizes from a model share that model's
      // .sqlx, so several rows can point at one file. They are genuinely separate actions, so they
      // stay separate rows — clicking any of them opens the file they were generated from.
      nodes: [...byType.get(type)!].sort((a, b) => a.id.localeCompare(b.id)),
    }));
  }

  dispose(): void {
    for (const d of this.subscriptions.splice(0)) d.dispose();
  }
}

function tooltipFor(node: DataformNode): vscode.MarkdownString {
  const lines = [`**${node.id}** · \`${node.type}\``, "", path.basename(node.filePath)];
  if (node.description) lines.push("", node.description);
  if (node.tags.length) lines.push("", `Tags: ${node.tags.join(", ")}`);
  if (node.refs.length) lines.push("", `Depends on: ${node.refs.join(", ")}`);
  return new vscode.MarkdownString(lines.join("\n"));
}
