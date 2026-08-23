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
  type CompiledSqlSection,
  type SerializedGraph,
} from "@dataform-dag/core";
import type { CompilationStatus, GraphMode } from "@dataform-dag/ui";

/**
 * Wait before announcing `compiling` so a warm cache hit — which resolves in a few ms — doesn't
 * flash the status pill on and straight back off.
 */
const COMPILE_STATUS_DELAY_MS = 300;

/** Why a refresh produced no graph. Callers decide whether a missing folder deserves a warning. */
export type RefreshResult = "ok" | "no-workspace" | "failed";

/** `undefined` means the request was superseded by a newer file change and must not be rendered. */
export type CompiledSqlResult =
  | { ok: true; sections: CompiledSqlSection[] }
  | { ok: false; message: string }
  | undefined;

/**
 * The workspace's graph, owned independently of any view.
 *
 * Every view-specific concern (a webview panel, the activity-bar tree) subscribes to this rather
 * than building its own graph: one `.sqlx` watcher, one compile cache, one authoritative
 * {@link GraphMode}. Two consumers computing their own graphs would disagree on node count the
 * moment one of them switched to compiled mode.
 *
 * Deliberately silent: a missing workspace folder or a failed build is reported through the return
 * value / an error toast, never by assuming a user is watching. The store outlives the panel, so it
 * is disposed with the extension, not with a view.
 */
export class GraphStore implements vscode.Disposable {
  private graph: SerializedGraph | undefined;
  /** filePath → node id, refreshed on each build so an active editor can resolve to its node. */
  private idByPath = new Map<string, string>();
  private mode: GraphMode = "parsed";
  /** Last successful compile, keyed by root so a folder switch can never serve another's output. */
  private compileCache: { root: string; output: CompileOutput } | undefined;
  private compileInFlight:
    | { root: string; generation: number; promise: Promise<CompileOutput> }
    | undefined;
  /**
   * Bumped whenever a `.sqlx` changes. A compile that started before the bump is stale on arrival:
   * its result must not reach the cache OR a view, so every consumer re-checks this after awaiting.
   */
  private compileGeneration = 0;
  private compileStatusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly graphEmitter = new vscode.EventEmitter<SerializedGraph>();
  private readonly modeEmitter = new vscode.EventEmitter<GraphMode>();
  private readonly statusEmitter = new vscode.EventEmitter<CompilationStatus>();
  /** Fires on every successful build, with the graph each view should render. */
  readonly onDidChangeGraph = this.graphEmitter.event;
  /** Fires when the mode changes — including the involuntary compiled → parsed fallback. */
  readonly onDidChangeMode = this.modeEmitter.event;
  readonly onDidChangeCompilationStatus = this.statusEmitter.event;

  constructor() {
    // The watcher belongs to the store, not to a view: closing the panel must not stop the tree
    // from updating, and neither view should be able to tear the other's live updates down.
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.sqlx");
    const rebuild = (): void => {
      this.invalidateCompilation();
      void this.refresh();
    };
    watcher.onDidChange(rebuild, undefined, this.disposables);
    watcher.onDidCreate(rebuild, undefined, this.disposables);
    watcher.onDidDelete(rebuild, undefined, this.disposables);
    this.disposables.push(watcher, this.graphEmitter, this.modeEmitter, this.statusEmitter);
  }

  /** The graph as last built, or `undefined` before the first successful build. */
  get current(): SerializedGraph | undefined {
    return this.graph;
  }

  get graphMode(): GraphMode {
    return this.mode;
  }

  nodeIdForFile(filePath: string): string | undefined {
    return this.idByPath.get(filePath);
  }

  /** Build only if nothing has been built yet — the lazy path for a view that just became visible. */
  async ensureGraph(): Promise<RefreshResult> {
    if (this.graph) return "ok";
    return this.refresh();
  }

  /**
   * Switch tiers and rebuild. Re-selecting the mode already in effect is a no-op — unlike the
   * pre-store handler, which rebuilt on every click of the toggle. Use `refresh()` for a refresh.
   */
  async setMode(mode: GraphMode): Promise<void> {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeEmitter.fire(mode);
    await this.refresh();
  }

  /** Rebuild from the workspace and publish the result to every subscriber. */
  async refresh(): Promise<RefreshResult> {
    const root = this.workspaceRoot();
    if (!root) return "no-workspace";
    try {
      if (this.mode === "compiled") {
        const output = await this.compile(root);
        // Compiled `fileName`s are relative to the project root; views compare them against
        // absolute editor paths for focus and for the SQL request, so resolve them here.
        this.publish(serializeGraph(graphFromCompileOutput(output)), root, true);
      } else {
        this.publish(
          serializeGraph(await buildGraphFromWorkspace(new NodeFileSource(root))),
          root,
          false,
        );
      }
      return "ok";
    } catch (err) {
      // A compiled build can fail for ordinary reasons (no CLI, project doesn't compile). Report it
      // and fall back to the parsed tier rather than leaving every view empty.
      if (this.mode === "compiled") {
        this.setCompileStatus("error");
        vscode.window.showErrorMessage(
          `Dataform DAG: could not compile the project — ${String(err)}`,
        );
        this.mode = "parsed";
        this.modeEmitter.fire("parsed");
        void this.refresh();
        return "failed";
      }
      vscode.window.showErrorMessage(`Dataform DAG: could not build the graph — ${String(err)}`);
      return "failed";
    }
  }

  private publish(serialized: SerializedGraph, root: string, resolvePaths: boolean): void {
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
    this.graph = graph;
    this.graphEmitter.fire(graph);
  }

  /**
   * Compile `root`, reusing the cached output when it is still current. Concurrent callers share one
   * in-flight run rather than spawning a second CLI process.
   */
  private async compile(root: string): Promise<CompileOutput> {
    if (this.compileCache?.root === root) return this.compileCache.output;
    if (this.compileInFlight?.root === root) return this.compileInFlight.promise;

    const generation = this.compileGeneration;
    this.compileStatusTimer = setTimeout(
      () => this.setCompileStatus("compiling"),
      COMPILE_STATUS_DELAY_MS,
    );
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

  /** The compiled SQL for one node, or `undefined` when a file change superseded the request. */
  async compiledSqlFor(nodeId: string, filePath: string): Promise<CompiledSqlResult> {
    const root = this.workspaceRoot();
    if (!root) return { ok: false, message: "No workspace folder is open." };
    const generation = this.compileGeneration;
    try {
      const output = await this.compile(root);
      // Gate the RESULT, not just the cache write: a superseded compile must not paint stale SQL.
      if (generation !== this.compileGeneration) return undefined;
      // `nodeId` as the target name is what picks the table over an assertion generated from the
      // same file — the same disambiguation `idByPath` needs above.
      const action = findCompiledActionByFile(output, path.relative(root, filePath), nodeId);
      if (!action) {
        return { ok: false, message: `No compiled action found for ${path.basename(filePath)}.` };
      }
      return { ok: true, sections: compiledSqlSections(action) };
    } catch (err) {
      if (generation !== this.compileGeneration) return undefined;
      this.setCompileStatus("error");
      return { ok: false, message: String(err) };
    }
  }

  /** The first workspace folder, or `undefined`. Silent by design — see the class doc. */
  workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private invalidateCompilation(): void {
    this.compileGeneration++;
    this.compileCache = undefined;
    this.compileInFlight = undefined;
    this.clearCompileStatusTimer();
    this.setCompileStatus("idle");
  }

  private setCompileStatus(status: CompilationStatus): void {
    this.statusEmitter.fire(status);
  }

  private clearCompileStatusTimer(): void {
    if (this.compileStatusTimer !== undefined) {
      clearTimeout(this.compileStatusTimer);
      this.compileStatusTimer = undefined;
    }
  }

  dispose(): void {
    this.clearCompileStatusTimer();
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}
