import * as path from "node:path";
import * as vscode from "vscode";
import {
  NodeFileSource,
  buildGraphFromWorkspace,
  compileDataformProject,
  compiledSqlSections,
  findCompiledActionByFile,
  graphFromCompileOutput,
  serializeGraph,
  type CompileOutput,
  type SerializedGraph,
} from "@dataform-dag/core";
// The wire protocol is defined once in the UI package; the host imports it as types only, so no
// React reaches the Node bundle.
import type { GraphMode, InboundMsg, OutboundMsg } from "@dataform-dag/ui";

const COMMAND_SHOW_GRAPH = "dataformDag.showGraph";
const COMMAND_SHOW_COMPILED_SQL = "dataformDag.showCompiledSql";
const TAG_FILTER_KEY = "dataformDag.selectedTags";
/**
 * Wait before announcing `compiling` so a warm cache hit — which resolves in a few ms — doesn't
 * flash the status pill on and straight back off.
 */
const COMPILE_STATUS_DELAY_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const controller = new GraphController(context);
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_GRAPH, () => controller.show()),
    vscode.commands.registerCommand(COMMAND_SHOW_COMPILED_SQL, () =>
      void controller.showCompiledSqlForActiveEditor(),
    ),
    controller,
  );
}

export function deactivate(): void {
  /* GraphController disposes via context.subscriptions. */
}

/**
 * Owns the single DAG webview panel and everything host-specific behind the {@link HostBridge}
 * contract: builds the graph from the workspace (parsed or compiled), opens files on request,
 * watches `.sqlx` for live updates, mirrors the active editor as a focus request, and serves
 * compiled SQL for a node.
 */
class GraphController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelDisposables: vscode.Disposable[] = [];
  /** filePath → node id, refreshed on each build so an active-editor change can focus its node. */
  private idByPath = new Map<string, string>();
  private graphMode: GraphMode = "parsed";
  private selectedTags: string[] = [];
  /** Last successful compile, keyed by root so a folder switch can never serve another's output. */
  private compileCache: { root: string; output: CompileOutput } | undefined;
  private compileInFlight: { root: string; generation: number; promise: Promise<CompileOutput> } | undefined;
  /**
   * Bumped whenever a `.sqlx` changes. A compile that started before the bump is stale on arrival:
   * its result must not reach the cache OR the webview, so every consumer re-checks this after
   * awaiting.
   */
  private compileGeneration = 0;
  private compileStatusTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

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

    // liveWatch: any .sqlx change invalidates the compile cache, then rebuilds and repushes.
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.sqlx");
    const rebuild = (): void => {
      this.invalidateCompilation();
      void this.buildAndPost();
    };
    watcher.onDidChange(rebuild, undefined, this.panelDisposables);
    watcher.onDidCreate(rebuild, undefined, this.panelDisposables);
    watcher.onDidDelete(rebuild, undefined, this.panelDisposables);
    this.panelDisposables.push(watcher);

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
        this.post({ type: "graphModeState", mode: this.graphMode });
        void this.buildAndPost();
        return;
      case "requestRefresh":
        void this.buildAndPost();
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
      case "setGraphMode":
        this.graphMode = msg.mode;
        this.post({ type: "graphModeState", mode: msg.mode });
        void this.buildAndPost();
        return;
    }
  }

  private async buildAndPost(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    try {
      if (this.graphMode === "compiled") {
        const output = await this.compile(root);
        // Compiled `fileName`s are relative to the project root; the webview compares them against
        // absolute editor paths for focus and for the SQL request, so resolve them here.
        this.postGraph(serializeGraph(graphFromCompileOutput(output)), root, true);
      } else {
        this.postGraph(serializeGraph(await buildGraphFromWorkspace(new NodeFileSource(root))), root, false);
      }
    } catch (err) {
      // A compiled build can fail for ordinary reasons (no CLI, project doesn't compile). Report it
      // and fall back to the parsed tier rather than leaving the panel empty.
      if (this.graphMode === "compiled") {
        this.setCompileStatus("error");
        vscode.window.showErrorMessage(
          `Dataform DAG: could not compile the project — ${String(err)}`,
        );
        this.graphMode = "parsed";
        this.post({ type: "graphModeState", mode: "parsed" });
        void this.buildAndPost();
        return;
      }
      vscode.window.showErrorMessage(`Dataform DAG: could not build the graph — ${String(err)}`);
    }
  }

  private postGraph(serialized: SerializedGraph, root: string, resolvePaths: boolean): void {
    const graph: SerializedGraph = resolvePaths
      ? {
          ...serialized,
          nodes: serialized.nodes.map((node) => ({
            ...node,
            filePath: path.isAbsolute(node.filePath)
              ? node.filePath
              : path.resolve(root, node.filePath),
          })),
        }
      : serialized;
    // FIRST match wins: in compiled mode one .sqlx yields a table AND the assertions Dataform
    // generates from it, and `new Map(nodes.map(...))` would leave the file pointing at the
    // assertion, so focusing the active editor would select the wrong node.
    this.idByPath = new Map();
    for (const node of graph.nodes) {
      if (!this.idByPath.has(node.filePath)) this.idByPath.set(node.filePath, node.id);
    }
    this.post({ type: "graphUpdate", graph });
  }

  /**
   * Compile `root`, reusing the cached output when it is still current. Concurrent callers share one
   * in-flight run rather than spawning a second CLI process.
   */
  private async compile(root: string): Promise<CompileOutput> {
    if (this.compileCache?.root === root) return this.compileCache.output;
    if (this.compileInFlight?.root === root) return this.compileInFlight.promise;

    const generation = this.compileGeneration;
    this.compileStatusTimer = setTimeout(() => this.setCompileStatus("compiling"), COMPILE_STATUS_DELAY_MS);
    const promise = compileDataformProject(root)
      .then((output) => {
        this.clearCompileStatusTimer();
        // A `.sqlx` changed while this ran — the output describes a project state that no longer
        // exists, so it must not be cached or shown.
        if (generation !== this.compileGeneration) return output;
        this.compileCache = { root, output };
        this.setCompileStatus("ready");
        return output;
      })
      .finally(() => {
        this.clearCompileStatusTimer();
        if (this.compileInFlight?.generation === generation) this.compileInFlight = undefined;
      });
    this.compileInFlight = { root, generation, promise };
    return promise;
  }

  private async sendCompiledSql(nodeId: string, filePath: string): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    const generation = this.compileGeneration;
    try {
      const output = await this.compile(root);
      // Gate the POST, not just the cache write: a superseded compile must not paint stale SQL.
      if (generation !== this.compileGeneration) return;
      // `nodeId` as the target name is what picks the table over an assertion generated from the
      // same file — the same disambiguation `idByPath` needs above.
      const action = findCompiledActionByFile(output, path.relative(root, filePath), nodeId);
      if (!action) {
        this.post({
          type: "compiledSqlError",
          nodeId,
          message: `No compiled action found for ${path.basename(filePath)}.`,
        });
        return;
      }
      this.post({ type: "compiledSqlResult", nodeId, sections: compiledSqlSections(action) });
    } catch (err) {
      if (generation !== this.compileGeneration) return;
      this.setCompileStatus("error");
      this.post({ type: "compiledSqlError", nodeId, message: String(err) });
    }
  }

  /** The `Show Compiled SQL` command: resolve the active editor to a node, then reuse the panel path. */
  async showCompiledSqlForActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Dataform DAG: open a .sqlx file to see its compiled SQL.");
      return;
    }
    this.show();
    const filePath = editor.document.uri.fsPath;
    // Invoking this from the palette is usually the FIRST thing that opens the panel, so `idByPath`
    // is still empty — the webview hasn't sent `ready` yet. Build once before giving up, otherwise
    // the most common entry point always answers "not in the graph".
    if (!this.idByPath.has(filePath)) await this.buildAndPost();
    const nodeId = this.idByPath.get(filePath);
    if (!nodeId) {
      vscode.window.showWarningMessage(
        "Dataform DAG: that file is not in the graph yet — refresh and try again.",
      );
      return;
    }
    this.post({ type: "focusNode", nodeId });
    void this.sendCompiledSql(nodeId, filePath);
  }

  private invalidateCompilation(): void {
    this.compileGeneration++;
    this.compileCache = undefined;
    this.compileInFlight = undefined;
    this.clearCompileStatusTimer();
    this.setCompileStatus("idle");
  }

  private setCompileStatus(status: "idle" | "compiling" | "ready" | "error"): void {
    this.post({ type: "compilationStatus", status });
  }

  private clearCompileStatusTimer(): void {
    if (this.compileStatusTimer !== undefined) {
      clearTimeout(this.compileStatusTimer);
      this.compileStatusTimer = undefined;
    }
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

  private workspaceRoot(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) vscode.window.showWarningMessage("Dataform DAG: open a folder to view its .sqlx graph.");
    return root;
  }

  private focusActive(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const nodeId = this.idByPath.get(editor.document.uri.fsPath);
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
    this.clearCompileStatusTimer();
    for (const d of this.panelDisposables.splice(0)) d.dispose();
  }

  dispose(): void {
    this.closePanel();
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
