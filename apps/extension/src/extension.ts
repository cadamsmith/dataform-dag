import * as vscode from "vscode";
import type { InboundMsg, OutboundMsg } from "@dataform-dag/ui";
import { DagTreeProvider, type TreeEntry, type TreeGrouping } from "./dagTreeProvider.js";
import { GraphStore, type CompilationState } from "./graphStore.js";

const COMMAND_SHOW_GRAPH = "dataformDag.showGraph";
const COMMAND_SHOW_COMPILED_SQL = "dataformDag.showCompiledSql";
const COMMAND_REFRESH = "dataformDag.refresh";
const COMMAND_REVEAL_NODE = "dataformDag.revealNode";
const COMMAND_GROUP_BY_FOLDER = "dataformDag.groupByFolder";
const COMMAND_GROUP_BY_TYPE = "dataformDag.groupByType";
const VIEW_NODES = "dataformDag.nodes";
const TAG_FILTER_KEY = "dataformDag.selectedTags";
/** Both the workspaceState key and the context key the view title's toggle button reads. */
const TREE_GROUPING_KEY = "dataformDag.treeGrouping";

export function activate(context: vscode.ExtensionContext): void {
  const store = new GraphStore();
  const controller = new GraphController(context, store);
  const tree = new DagTreeProvider(store);
  const treeView = vscode.window.createTreeView(VIEW_NODES, { treeDataProvider: tree });
  const setGrouping = (grouping: TreeGrouping): void => {
    tree.setGrouping(grouping);
    void context.workspaceState.update(TREE_GROUPING_KEY, grouping);
    void vscode.commands.executeCommand("setContext", TREE_GROUPING_KEY, grouping);
  };
  setGrouping(context.workspaceState.get(TREE_GROUPING_KEY) === "folder" ? "folder" : "type");
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_GRAPH, () => controller.show()),
    vscode.commands.registerCommand(COMMAND_SHOW_COMPILED_SQL, (arg?: unknown) =>
      void controller.showCompiledSql(nodeOf(arg)),
    ),
    vscode.commands.registerCommand(COMMAND_REFRESH, () => void store.recompile()),
    vscode.commands.registerCommand(COMMAND_REVEAL_NODE, (arg?: unknown) =>
      controller.revealNode(nodeOf(arg)),
    ),
    vscode.commands.registerCommand(COMMAND_GROUP_BY_FOLDER, () => setGrouping("folder")),
    vscode.commands.registerCommand(COMMAND_GROUP_BY_TYPE, () => setGrouping("type")),
    treeView,
    // The tree has no pill of its own, so a failure that left the last good graph listed is
    // stated in the view's message instead.
    store.onDidChangeCompilationStatus((state) => {
      treeView.message = treeMessage(state, store.current !== undefined);
    }),
    tree,
    controller,
    store,
  );
  // Subscribers are wired; start the first compile without waiting for a view to ask.
  store.start();
}

function treeMessage(state: CompilationState, hasGraph: boolean): string | undefined {
  if (!hasGraph) return undefined; // the viewsWelcome content covers the empty tree
  if (state.status === "error") return "Compile failed — showing the last good graph.";
  if (state.status === "cli-missing") return "Dataform CLI not found — showing the last good graph.";
  return undefined;
}

/**
 * Commands reachable from BOTH the palette and a tree row have to cope with either call shape: the
 * palette passes nothing, a tree menu passes the {@link TreeEntry} that row was built from.
 */
function nodeOf(arg: unknown): { id: string; filePath: string } | undefined {
  const entry = arg as TreeEntry | undefined;
  if (entry?.kind !== "node") return undefined;
  return { id: entry.node.id, filePath: entry.node.filePath };
}

export function deactivate(): void {
  /* GraphController and GraphStore dispose via context.subscriptions. */
}

/**
 * The webview panel's half of the {@link HostBridge} contract: renders the DAG canvas, translates
 * its messages into {@link GraphStore} calls, and mirrors the store's events back over postMessage.
 * The graph itself, the project watcher, and the compile cache belong to the store — this class owns
 * only what dies with the panel.
 */
class GraphController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly storeSubscriptions: vscode.Disposable[] = [];
  private selectedTags: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: GraphStore,
  ) {
    this.storeSubscriptions.push(
      store.onDidChangeGraph((graph) => this.post({ type: "graphUpdate", graph })),
      store.onDidChangeCompilationStatus((state) =>
        this.post({ type: "compilationStatus", ...state }),
      ),
    );
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "dataformDag",
      "Dataform DAG",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
      },
    );
    this.panel = panel;
    panel.webview.html = this.render(panel.webview);

    panel.webview.onDidReceiveMessage(
      (msg: OutboundMsg) => this.onMessage(msg),
      undefined,
      this.panelDisposables,
    );

    // focusOnActive: reflect the active editor into the graph when it maps to a node.
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.focusActive(editor),
      undefined,
      this.panelDisposables,
    );

    panel.onDidDispose(() => this.closePanel(), undefined, this.panelDisposables);
  }

  private onMessage(msg: OutboundMsg): void {
    switch (msg.type) {
      case "ready":
        this.selectedTags = this.readSavedTagFilter();
        // Send the restored filter ONCE, on connect. Echoing it after each `setTagFilter` would
        // fight the user's own clicks in the UI.
        this.post({ type: "tagFilterState", selectedTags: this.selectedTags });
        // The store may have compiled (or failed) before this panel existed: hand over what it has
        // now, then build — a cache hit just re-publishes, a past failure gets retried.
        if (this.store.current) this.post({ type: "graphUpdate", graph: this.store.current });
        this.post({ type: "compilationStatus", ...this.store.compilation });
        void this.build();
        return;
      case "requestRefresh":
        void this.build();
        return;
      case "openFile":
        void vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), {
          viewColumn: vscode.ViewColumn.One,
          preview: false,
        });
        return;
      case "showCompiledSql":
        void this.sendCompiledSql(msg.nodeId, msg.filePath);
        return;
      case "setTagFilter":
        this.saveTagFilter(msg.selectedTags);
        return;
    }
  }

  /**
   * A build the user is watching: unlike the store's silent refresh, a missing workspace folder is
   * worth saying out loud here, because the panel they just opened will otherwise sit empty.
   */
  private async build(): Promise<void> {
    if ((await this.store.refresh()) === "no-workspace") {
      vscode.window.showWarningMessage("Dataform DAG: open a folder to view its graph.");
    }
  }

  private async sendCompiledSql(nodeId: string, filePath: string): Promise<void> {
    const result = await this.store.compiledSqlFor(nodeId, filePath);
    if (!result) return; // superseded by a file change
    this.post(
      result.ok
        ? { type: "compiledSqlResult", nodeId, sections: result.sections }
        : { type: "compiledSqlError", nodeId, message: result.message },
    );
  }

  /**
   * Open a node's file, and focus it on the canvas when the panel happens to be open. Clicking a
   * tree row must NOT force the webview open — the tree is usable on its own.
   */
  revealNode(node: { id: string; filePath: string } | undefined): void {
    if (!node) return;
    void vscode.window.showTextDocument(vscode.Uri.file(node.filePath), {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    this.post({ type: "focusNode", nodeId: node.id });
  }

  /**
   * The `Show Compiled SQL` command. From a tree row the node is already known; from the palette it
   * has to be resolved out of the active editor.
   */
  async showCompiledSql(node?: { id: string; filePath: string }): Promise<void> {
    if (node) {
      this.show();
      this.post({ type: "focusNode", nodeId: node.id });
      await this.sendCompiledSql(node.id, node.filePath);
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Dataform DAG: open a .sqlx file to see its compiled SQL.");
      return;
    }
    this.show();
    const filePath = editor.document.uri.fsPath;
    // Invoking this from the palette is usually the FIRST thing that opens the panel, so the store
    // may not have built yet. Build once before giving up, otherwise the most common entry point
    // always answers "not in the graph".
    if (!this.store.nodeIdForFile(filePath)) await this.build();
    const nodeId = this.store.nodeIdForFile(filePath);
    if (!nodeId) {
      vscode.window.showWarningMessage(
        "Dataform DAG: that file is not in the graph yet — refresh and try again.",
      );
      return;
    }
    this.post({ type: "focusNode", nodeId });
    void this.sendCompiledSql(nodeId, filePath);
  }

  private readSavedTagFilter(): string[] {
    const saved: unknown = this.context.workspaceState.get(TAG_FILTER_KEY);
    if (!Array.isArray(saved)) return [];
    return saved.filter((v): v is string => typeof v === "string");
  }

  private saveTagFilter(selectedTags: string[]): void {
    this.selectedTags = [...selectedTags];
    void this.context.workspaceState.update(TAG_FILTER_KEY, this.selectedTags);
  }

  private focusActive(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const nodeId = this.store.nodeIdForFile(editor.document.uri.fsPath);
    if (nodeId) this.post({ type: "focusNode", nodeId });
  }

  private post(msg: InboundMsg): void {
    void this.panel?.webview.postMessage(msg);
  }

  private render(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    // React Flow positions nodes with inline `style` attributes, so style-src needs 'unsafe-inline';
    // scripts are locked to the single nonce'd bundle (elk is inlined into it — see build.mjs).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>Dataform DAG</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private closePanel(): void {
    this.panel = undefined;
    for (const d of this.panelDisposables.splice(0)) d.dispose();
  }

  dispose(): void {
    this.closePanel();
    for (const d of this.storeSubscriptions.splice(0)) d.dispose();
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
