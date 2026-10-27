import * as path from "node:path";
import * as vscode from "vscode";
import type { DataformNode, SerializedGraph } from "@dataform-dag/core";
import type { GraphStore } from "./graphStore.js";
import { refAt, resolveTarget } from "./refs.js";

/**
 * The files a `ref()` can appear in. Matched by path, not language id: `.sqlx` has no built-in
 * language, and whichever Dataform syntax extension a user has installed names it differently.
 */
export const REF_DOCUMENTS: vscode.DocumentFilter[] = [
  { scheme: "file", pattern: "**/*.sqlx" },
  { scheme: "file", pattern: "**/definitions/**/*.js" },
  { scheme: "file", pattern: "**/includes/**/*.js" },
];

/** The command a lens runs: the tree's "Focus in Graph", handed the tree-row shape it expects. */
const COMMAND_FOCUS_IN_GRAPH = "dataformDag.focusInGraph";

/**
 * Editor features over the compiled graph: go-to-definition and hover on `ref()` and `dependencies`
 * entries, and a lens over each action with its upstream/downstream counts that opens its lineage.
 *
 * Everything reads {@link GraphStore.current}, so it agrees with the canvas and the tree; before the
 * first compile there is no graph and every provider answers nothing rather than guessing.
 */
export class RefNavigation
  implements vscode.DefinitionProvider, vscode.HoverProvider, vscode.CodeLensProvider, vscode.Disposable
{
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.lensEmitter];
  /** Lookups built once per graph — the store hands out a new object on every publish. */
  private indexed: { graph: SerializedGraph; index: GraphLookup } | undefined;

  constructor(private readonly store: GraphStore) {
    this.disposables.push(
      store.onDidChangeGraph(() => this.lensEmitter.fire()),
      vscode.languages.registerDefinitionProvider(REF_DOCUMENTS, this),
      vscode.languages.registerHoverProvider(REF_DOCUMENTS, this),
      vscode.languages.registerCodeLensProvider(REF_DOCUMENTS, this),
    );
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    const hit = this.nodesAt(document, position);
    if (!hit) return undefined;
    const origin = new vscode.Range(document.positionAt(hit.start), document.positionAt(hit.end));
    const links: vscode.LocationLink[] = [];
    for (const node of hit.nodes) {
      const target = await this.positionOf(node);
      links.push({
        originSelectionRange: origin,
        targetUri: vscode.Uri.file(node.filePath),
        targetRange: new vscode.Range(target, target),
      });
    }
    return links;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const hit = this.nodesAt(document, position);
    if (!hit) return undefined;
    const root = this.store.workspaceRoot();
    const { index } = this.lookup()!;
    const blocks = hit.nodes.map((node) => {
      const lines = [
        `**${node.id}** · ${node.type}`,
        ...(node.description ? ["", node.description] : []),
        "",
        `${node.refs.length} upstream · ${index.dependents(node.id).length} downstream` +
          (root ? ` · \`${path.relative(root, node.filePath)}\`` : ""),
      ];
      return lines.join("\n");
    });
    return new vscode.Hover(
      new vscode.MarkdownString(blocks.join("\n\n---\n\n")),
      new vscode.Range(document.positionAt(hit.start), document.positionAt(hit.end)),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const found = this.lookup();
    if (!found) return [];
    const { index } = found;
    const nodes = index.byFile.get(document.uri.fsPath) ?? [];
    if (nodes.length === 0) return [];
    const text = document.getText();
    // A .sqlx yields its own action first, then the assertions Dataform generates from its config.
    // Those are reached from the canvas; the lens is for the action the file IS. A definitions .js
    // can publish many actions, each with a lens on the line that names it.
    const shown = document.uri.fsPath.endsWith(".sqlx") ? nodes.slice(0, 1) : nodes;
    return shown.map((node) => {
      const at = document.positionAt(lensOffset(text, node));
      const upstream = node.refs.length;
      const downstream = index.dependents(node.id).length;
      const prefix = shown.length > 1 ? `${node.id}: ` : "";
      return new vscode.CodeLens(new vscode.Range(at, at), {
        title: `${prefix}$(arrow-up) ${upstream} upstream · $(arrow-down) ${downstream} downstream`,
        tooltip: "Show this action's lineage in the Dataform DAG",
        command: COMMAND_FOCUS_IN_GRAPH,
        arguments: [{ kind: "node", node }],
      });
    });
  }

  /** The reference under `position` and the node(s) it resolves to, or undefined. */
  private nodesAt(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { start: number; end: number; nodes: DataformNode[] } | undefined {
    const found = this.lookup();
    if (!found) return undefined;
    const site = refAt(document.getText(), document.offsetAt(position));
    if (!site) return undefined;
    const { index } = found;
    const nodes = resolveTarget(site.target, index.ids)
      .map((id) => index.byId.get(id))
      .filter((n): n is DataformNode => !!n);
    return nodes.length > 0 ? { start: site.start, end: site.end, nodes } : undefined;
  }

  /**
   * Where to land in a node's file: its first line for a `.sqlx` (the file is the action), else the
   * line naming it — a definitions `.js` declares several actions, and the top of the file is
   * rarely the one you asked for.
   */
  private async positionOf(node: DataformNode): Promise<vscode.Position> {
    if (node.filePath.endsWith(".sqlx")) return new vscode.Position(0, 0);
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
      return doc.positionAt(lensOffset(doc.getText(), node));
    } catch {
      return new vscode.Position(0, 0);
    }
  }

  private lookup(): { graph: SerializedGraph; index: GraphLookup } | undefined {
    const graph = this.store.current;
    if (!graph) return undefined;
    if (this.indexed?.graph !== graph) this.indexed = { graph, index: new GraphLookup(graph) };
    return this.indexed;
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}

class GraphLookup {
  readonly ids: ReadonlySet<string>;
  readonly byId: ReadonlyMap<string, DataformNode>;
  /** Every node a file yields, in compile order. */
  readonly byFile: ReadonlyMap<string, DataformNode[]>;
  private readonly downstream: ReadonlyMap<string, string[]>;

  constructor(graph: SerializedGraph) {
    this.ids = new Set(graph.nodes.map((n) => n.id));
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const byFile = new Map<string, DataformNode[]>();
    for (const n of graph.nodes) byFile.set(n.filePath, [...(byFile.get(n.filePath) ?? []), n]);
    this.byFile = byFile;
    this.downstream = new Map(graph.downstream);
  }

  dependents(id: string): string[] {
    return this.downstream.get(id) ?? [];
  }
}

/**
 * Where a node's lens goes: a `.sqlx` file's `config` block (else its top), or, in a `.js` file, the
 * first quoted occurrence of the node's name — the `publish("name", …)` that declares it. A
 * schema-qualified id is searched by its bare name, which is what the file spells.
 */
export function lensOffset(text: string, node: DataformNode): number {
  if (node.filePath.endsWith(".sqlx")) {
    const config = /^\s*config\s*\{/m.exec(text);
    return config ? config.index + config[0].indexOf("config") : 0;
  }
  const name = node.id.slice(node.id.lastIndexOf(".") + 1);
  const found = new RegExp(`(["'\`])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).exec(text);
  if (!found) return 0;
  // The start of that line, so the lens sits above the declaration rather than mid-statement.
  return text.lastIndexOf("\n", found.index) + 1;
}
