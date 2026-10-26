import * as path from "node:path";
import * as vscode from "vscode";
import {
  DataformCliNotFoundError,
  compileDataformProject,
  compiledSqlSections,
  findCompiledActionByFile,
  graphFromCompileOutput,
  resolveDataformCli,
  serializeGraph,
  type CompileOutput,
  type CompiledSqlSection,
  type SerializedGraph,
} from "@dataform-dag/core";
import type { CompilationStatus } from "@dataform-dag/ui";

/**
 * Wait before announcing `compiling` so a warm cache hit — which resolves in a few ms — doesn't
 * flash the status pill on and straight back off.
 */
const COMPILE_STATUS_DELAY_MS = 300;

/** Quiet period after the last file event before recompiling, so a burst of saves compiles once. */
export const RECOMPILE_DEBOUNCE_MS = 500;

/**
 * Everything that changes what `dataform compile` produces, relative to the project root. Kept flat
 * (no nested braces) because VS Code's glob matcher doesn't promise nested `{}` groups.
 */
const WATCH_GLOB =
  "{definitions/**/*.sqlx,definitions/**/*.js,includes/**/*.js,workflow_settings.yaml,dataform.json,package.json}";

const CONFIG_CLI_PATH = "dataformDag.cliPath";
/** `when`-clause keys driving the tree's `viewsWelcome` when there is no graph to list. */
const CONTEXT_CLI_MISSING = "dataformDag.cliMissing";
const CONTEXT_COMPILE_FAILED = "dataformDag.compileFailed";

/** Why a refresh produced no graph. Callers decide whether a missing folder deserves a warning. */
export type RefreshResult = "ok" | "no-workspace" | "failed";

/** The compile step's state plus, for a failure, what went wrong. */
export interface CompilationState {
  status: CompilationStatus;
  message?: string;
}

/** `undefined` means the request was superseded by a newer file change and must not be rendered. */
export type CompiledSqlResult =
  | { ok: true; sections: CompiledSqlSection[] }
  | { ok: false; message: string }
  | undefined;

/**
 * The workspace's graph, owned independently of any view.
 *
 * Every view-specific concern (a webview panel, the activity-bar tree) subscribes to this rather
 * than building its own graph: one project watcher, one compile cache, one source of truth.
 *
 * The graph always comes from `dataform compile --json`, recompiled in the background whenever a
 * watched file changes. A failed compile never clears the graph: views keep the last good one and
 * the failure is reported through {@link onDidChangeCompilationStatus}, not a toast per save.
 *
 * The store outlives the panel, so it is disposed with the extension, not with a view.
 */
export class GraphStore implements vscode.Disposable {
  private graph: SerializedGraph | undefined;
  /** filePath → node id, refreshed on each build so an active editor can resolve to its node. */
  private idByPath = new Map<string, string>();
  /** Last successful compile, keyed by root so a folder switch can never serve another's output. */
  private compileCache: { root: string; output: CompileOutput } | undefined;
  private compileInFlight:
    | { root: string; generation: number; promise: Promise<CompileOutput> }
    | undefined;
  /**
   * Bumped whenever a watched file changes. A compile that started before the bump is stale on
   * arrival: its result must not reach the cache OR a view, so every consumer re-checks this after
   * awaiting.
   */
  private compileGeneration = 0;
  private compileStatusTimer: ReturnType<typeof setTimeout> | undefined;
  private recompileTimer: ReturnType<typeof setTimeout> | undefined;
  private state: CompilationState = { status: "idle" };
  /** The missing-CLI toast is shown once per session; after that the views carry the message. */
  private cliMissingNotified = false;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly graphEmitter = new vscode.EventEmitter<SerializedGraph>();
  private readonly statusEmitter = new vscode.EventEmitter<CompilationState>();
  /** Fires on every successful build, with the graph each view should render. */
  readonly onDidChangeGraph = this.graphEmitter.event;
  readonly onDidChangeCompilationStatus = this.statusEmitter.event;

  constructor() {
    this.disposables.push(this.graphEmitter, this.statusEmitter);
    // The watcher belongs to the store, not to a view: closing the panel must not stop the tree
    // from updating, and neither view should be able to tear the other's live updates down.
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, WATCH_GLOB),
      );
      const onFileEvent = (): void => this.scheduleRecompile();
      watcher.onDidChange(onFileEvent, undefined, this.disposables);
      watcher.onDidCreate(onFileEvent, undefined, this.disposables);
      watcher.onDidDelete(onFileEvent, undefined, this.disposables);
      this.disposables.push(watcher);
    }
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration(CONFIG_CLI_PATH)) void this.recompile();
      },
      undefined,
      this.disposables,
    );
  }

  /** The graph as last built, or `undefined` before the first successful build. */
  get current(): SerializedGraph | undefined {
    return this.graph;
  }

  get compilation(): CompilationState {
    return this.state;
  }

  nodeIdForFile(filePath: string): string | undefined {
    return this.idByPath.get(filePath);
  }

  /** Compile eagerly at activation, so the graph is usually ready before any view asks for it. */
  start(): void {
    if (this.workspaceRoot()) void this.refresh();
  }

  /** Build only if nothing has been built yet — the lazy path for a view that just became visible. */
  async ensureGraph(): Promise<RefreshResult> {
    if (this.graph) return "ok";
    return this.refresh();
  }

  /** Drop the cache and compile now — the explicit "Refresh" path. */
  async recompile(): Promise<RefreshResult> {
    this.clearRecompileTimer();
    this.invalidateCompilation();
    return this.refresh();
  }

  /** Compile (or reuse the cached compile) and publish the result to every subscriber. */
  async refresh(): Promise<RefreshResult> {
    const root = this.workspaceRoot();
    if (!root) return "no-workspace";
    const generation = this.compileGeneration;
    try {
      const output = await this.compile(root);
      // A watched file changed mid-compile: this output describes a project that no longer exists,
      // and the debounced recompile already queued will publish the current one.
      if (generation !== this.compileGeneration) return "failed";
      // Compiled `fileName`s are relative to the project root; views compare them against
      // absolute editor paths for focus and for the SQL request, so resolve them here.
      this.publish(serializeGraph(graphFromCompileOutput(output)), root);
      return "ok";
    } catch (err) {
      if (generation !== this.compileGeneration) return "failed";
      this.reportFailure(err);
      return "failed";
    }
  }

  private publish(serialized: SerializedGraph, root: string): void {
    const graph: SerializedGraph = {
      ...serialized,
      nodes: serialized.nodes.map((node) => ({
        ...node,
        filePath: path.isAbsolute(node.filePath) ? node.filePath : path.resolve(root, node.filePath),
      })),
    };
    // FIRST match wins: one .sqlx yields a table AND the assertions Dataform generates from it, and
    // `new Map(nodes.map(...))` would leave the file pointing at the assertion, so focusing the
    // active editor would select the wrong node.
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
    if (this.state.status !== "compiling") {
      this.compileStatusTimer = setTimeout(
        () => this.setState({ status: "compiling" }),
        COMPILE_STATUS_DELAY_MS,
      );
    }
    const command = resolveDataformCli(
      root,
      vscode.workspace.getConfiguration().get<string>(CONFIG_CLI_PATH),
    );
    const promise = compileDataformProject(root, command)
      .then((output) => {
        // A watched file changed while this ran — the output describes a project state that no
        // longer exists, so it must not be cached or shown.
        if (generation !== this.compileGeneration) return output;
        this.compileCache = { root, output };
        this.clearCompileStatusTimer();
        this.setState({ status: "ready" });
        this.setContexts(false, false);
        return output;
      })
      .finally(() => {
        if (generation === this.compileGeneration) this.clearCompileStatusTimer();
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
      this.reportFailure(err);
      return { ok: false, message: errorMessage(err) };
    }
  }

  /** The first workspace folder, or `undefined`. Silent by design — see the class doc. */
  workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * A watched file changed. Invalidate NOW — so an in-flight compile can't publish, and the SQL on
   * screen is cleared — but compile only once the burst of events has gone quiet.
   */
  private scheduleRecompile(): void {
    this.invalidateCompilation();
    // A compile is definitely coming, so say so straight away rather than blanking the pill.
    this.setState({ status: "compiling" });
    this.clearRecompileTimer();
    this.recompileTimer = setTimeout(() => {
      this.recompileTimer = undefined;
      void this.refresh();
    }, RECOMPILE_DEBOUNCE_MS);
  }

  /** Record a failed compile. The graph is left as it was: views keep showing the last good one. */
  private reportFailure(err: unknown): void {
    this.clearCompileStatusTimer();
    if (err instanceof DataformCliNotFoundError) {
      this.setState({ status: "cli-missing", message: err.message });
      this.setContexts(true, false);
      if (!this.cliMissingNotified) {
        this.cliMissingNotified = true;
        void vscode.window
          .showErrorMessage(
            "Dataform DAG: the Dataform CLI was not found. Install @dataform/cli or set dataformDag.cliPath.",
            "Open Settings",
          )
          .then((choice) => {
            if (choice === "Open Settings") {
              void vscode.commands.executeCommand("workbench.action.openSettings", CONFIG_CLI_PATH);
            }
          });
      }
      return;
    }
    this.setState({ status: "error", message: errorMessage(err) });
    this.setContexts(false, true);
  }

  private invalidateCompilation(): void {
    this.compileGeneration++;
    this.compileCache = undefined;
    this.compileInFlight = undefined;
    this.clearCompileStatusTimer();
  }

  private setState(state: CompilationState): void {
    this.state = state;
    this.statusEmitter.fire(state);
  }

  private setContexts(cliMissing: boolean, compileFailed: boolean): void {
    void vscode.commands.executeCommand("setContext", CONTEXT_CLI_MISSING, cliMissing);
    void vscode.commands.executeCommand("setContext", CONTEXT_COMPILE_FAILED, compileFailed);
  }

  private clearCompileStatusTimer(): void {
    if (this.compileStatusTimer !== undefined) {
      clearTimeout(this.compileStatusTimer);
      this.compileStatusTimer = undefined;
    }
  }

  private clearRecompileTimer(): void {
    if (this.recompileTimer !== undefined) {
      clearTimeout(this.recompileTimer);
      this.recompileTimer = undefined;
    }
  }

  dispose(): void {
    this.clearCompileStatusTimer();
    this.clearRecompileTimer();
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}

/** The CLI colours its stderr; an execFile failure carries that verbatim into `message`. */
function errorMessage(err: unknown): string {
  // eslint-disable-next-line no-control-regex
  return (err instanceof Error ? err.message : String(err)).replace(/\x1b\[[0-9;]*m/g, "");
}
