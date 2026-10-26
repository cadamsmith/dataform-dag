import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { activate } from "../src/extension.js";
import {
  Uri,
  ViewColumn,
  changeConfig,
  commands,
  lastActiveEditorHandler,
  lastPanel,
  lastTreeView,
  lastWatcher,
  makeMemento,
  records,
  resetMock,
  window,
  workspace,
} from "./mocks/vscode.js";

// The controller's build path goes through core; mock it so these tests exercise the controller's
// orchestration (routing / watcher wiring / focus mapping / error handling), not core itself.
vi.mock("@dataform-dag/core", () => ({
  DataformCliNotFoundError: class extends Error {
    constructor(readonly command: string) {
      super(`Dataform CLI not found: ${command}`);
    }
  },
  resolveDataformCli: vi.fn((_root: string, configured?: string) => configured || "dataform"),
  serializeGraph: vi.fn(),
  compileDataformProject: vi.fn(),
  graphFromCompileOutput: vi.fn(),
  findCompiledActionByFile: vi.fn(),
  compiledSqlSections: vi.fn(),
}));
import {
  DataformCliNotFoundError,
  compileDataformProject,
  compiledSqlSections,
  findCompiledActionByFile,
  graphFromCompileOutput,
  serializeGraph,
} from "@dataform-dag/core";
import { RECOMPILE_DEBOUNCE_MS } from "../src/graphStore.js";

const serializeMock = serializeGraph as unknown as Mock;
const compileMock = compileDataformProject as unknown as Mock;
const fromCompileMock = graphFromCompileOutput as unknown as Mock;
const findActionMock = findCompiledActionByFile as unknown as Mock;
const sectionsMock = compiledSqlSections as unknown as Mock;

/** A serialized graph with two nodes, so focus mapping (filePath → id) has something to resolve. */
const SERIALIZED = {
  nodes: [
    { id: "a", filePath: "/proj/a.sqlx" },
    { id: "b", filePath: "/proj/b.sqlx" },
  ],
  edges: [],
};
const OUTPUT = { tables: [] };

function fakeContext() {
  return {
    subscriptions: [] as Array<{ dispose: () => void }>,
    extensionUri: Uri.file("/ext"),
    workspaceState: makeMemento(),
  };
}

/** Messages the host pushed to the webview, in order. */
function posted(): Array<{ type: string; [k: string]: unknown }> {
  return lastPanel().webview.postMessage.mock.calls.map(
    (c) => c[0] as { type: string; [k: string]: unknown },
  );
}

const postedOfType = (type: string) => posted().filter((m) => m.type === type);

/** Let queued microtasks (the controller's async build/compile chains) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Register the command via activate() and invoke it to open the panel. */
function activateAndShow() {
  const context = fakeContext();
  activate(context as never);
  const showGraph = records.commands.get("dataformDag.showGraph")!;
  showGraph();
  return context;
}

/** Activate with no view open, and wait for the eager compile to land. */
async function activateAndSettle() {
  const context = fakeContext();
  activate(context as never);
  await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(1));
  await flush();
  return context;
}

beforeEach(() => {
  vi.useRealTimers();
  resetMock();
  serializeMock.mockReset();
  serializeMock.mockReturnValue(SERIALIZED);
  compileMock.mockReset();
  compileMock.mockResolvedValue(OUTPUT);
  fromCompileMock.mockReset();
  fromCompileMock.mockReturnValue({ nodes: new Map(), downstreamMap: new Map(), issues: [] });
  findActionMock.mockReset();
  sectionsMock.mockReset();
  workspace.workspaceFolders = [{ uri: { fsPath: "/proj" } }];
});

describe("activate", () => {
  it("registers every contributed command", () => {
    activateAndShow();
    expect([...records.commands.keys()].sort()).toEqual([
      "dataformDag.focusInGraph",
      "dataformDag.groupByFolder",
      "dataformDag.groupByType",
      "dataformDag.refresh",
      "dataformDag.revealNode",
      "dataformDag.showCompiledSql",
      "dataformDag.showGraph",
    ]);
  });

  it("registers the activity-bar tree view and disposes everything it owns", () => {
    const context = activateAndShow();
    expect(lastTreeView().id).toBe("dataformDag.nodes");
    // 7 commands + the tree view + its status subscription + the tree provider + the controller +
    // the store
    expect(context.subscriptions).toHaveLength(12);
  });

  it("toggles the tree grouping, persisting it and updating the title-bar context", () => {
    const context = activateAndShow();
    expect(records.executed).toContainEqual(["setContext", "dataformDag.treeGrouping", "type"]);

    records.commands.get("dataformDag.groupByFolder")!();
    expect(records.executed).toContainEqual(["setContext", "dataformDag.treeGrouping", "folder"]);
    expect(context.workspaceState.get("dataformDag.treeGrouping")).toBe("folder");
  });

  it("restores the saved tree grouping on activate", async () => {
    const context = fakeContext();
    await context.workspaceState.update("dataformDag.treeGrouping", "folder");
    activate(context as never);
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(1));
    await flush();
    const roots = (await lastTreeView().provider.getChildren()) as Array<{ kind: string }>;
    expect(roots.map((r) => r.kind)).toEqual(["node", "node"]);
    expect(records.executed).toContainEqual(["setContext", "dataformDag.treeGrouping", "folder"]);
  });

  it("compiles eagerly, before any view is opened", async () => {
    await activateAndSettle();
    expect(compileMock).toHaveBeenCalledWith("/proj", "dataform");
    expect(window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("does not compile at activation when no folder is open", async () => {
    workspace.workspaceFolders = undefined;
    activate(fakeContext() as never);
    await flush();
    expect(compileMock).not.toHaveBeenCalled();
  });
});

describe("show", () => {
  it("creates exactly one webview panel (single mock-instance smoke check)", () => {
    activateAndShow();
    expect(records.panels).toHaveLength(1);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("reveals the existing panel instead of creating a second one", () => {
    const context = fakeContext();
    activate(context as never);
    const showGraph = records.commands.get("dataformDag.showGraph")!;
    showGraph();
    showGraph();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(lastPanel().reveal).toHaveBeenCalledTimes(1);
  });

  it("renders a CSP that nonces the script and forbids eval (invariant #1)", () => {
    activateAndShow();
    const { html } = lastPanel().webview;
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}'/);
    expect(html).not.toContain("unsafe-eval");
    expect(html).toContain("/ext/dist/webview.js");
  });
});

describe("message routing", () => {
  it("builds and posts the graph on 'ready'", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith({
        type: "graphUpdate",
        graph: SERIALIZED,
      }),
    );
  });

  it("republishes on 'requestRefresh' without recompiling a current cache", async () => {
    activateAndShow();
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(1));
    lastPanel().webview.emitMessage({ type: "requestRefresh" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(2));
    expect(compileMock).toHaveBeenCalledTimes(1);
  });

  it("hands a late-opening panel the graph and status the store already has", async () => {
    const context = await activateAndSettle();
    void context;
    records.commands.get("dataformDag.showGraph")!();
    lastPanel().webview.emitMessage({ type: "ready" });
    expect(postedOfType("graphUpdate")[0]).toEqual({ type: "graphUpdate", graph: SERIALIZED });
    expect(postedOfType("compilationStatus")[0]).toEqual({
      type: "compilationStatus",
      status: "ready",
    });
  });

  it("opens the file in column one on 'openFile'", () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "openFile", filePath: "/proj/a.sqlx" });
    expect(window.showTextDocument).toHaveBeenCalledTimes(1);
    const { uri, opts } = records.shownDocs[0];
    expect(uri.fsPath).toBe("/proj/a.sqlx");
    expect(opts).toEqual({ viewColumn: ViewColumn.One, preview: false });
  });
});

describe("buildAndPost", () => {
  it("warns and does not post when no folder is open", async () => {
    workspace.workspaceFolders = undefined;
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(records.warnings).toHaveLength(1));
    expect(records.warnings[0]).toMatch(/open a folder/i);
    expect(compileMock).not.toHaveBeenCalled();
    // `ready` still replies with the restored filter and status; only the graph is withheld.
    expect(postedOfType("graphUpdate")).toHaveLength(0);
  });

  it("reports a first-compile failure as status, not a toast, and posts no graph", async () => {
    compileMock.mockRejectedValue(new Error("definitions/a.sqlx: boom"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() =>
      expect(postedOfType("compilationStatus").at(-1)).toEqual({
        type: "compilationStatus",
        status: "error",
        message: "definitions/a.sqlx: boom",
      }),
    );
    expect(records.errors).toHaveLength(0);
    expect(postedOfType("graphUpdate")).toHaveLength(0);
    expect(records.executed).toContainEqual(["setContext", "dataformDag.compileFailed", true]);
  });

  it("strips the CLI's ANSI colours from a failure message", async () => {
    compileMock.mockRejectedValue(new Error("\x1b[91mnot a dataform directory\x1b[0m"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() =>
      expect(postedOfType("compilationStatus").at(-1)).toMatchObject({
        message: "not a dataform directory",
      }),
    );
  });

  it("compiles the first workspace folder with the resolved CLI", async () => {
    await activateAndSettle();
    expect(compileMock.mock.calls[0]).toEqual(["/proj", "dataform"]);
  });

  it("resolves compiled relative paths against the workspace root", async () => {
    serializeMock.mockReturnValue({
      nodes: [{ id: "a", filePath: "definitions/a.sqlx" }],
      downstream: [],
      issues: [],
    });
    activateAndShow();
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(1));
    const update = postedOfType("graphUpdate")[0] as { graph: { nodes: Array<{ filePath: string }> } };
    expect(update.graph.nodes[0].filePath).toBe("/proj/definitions/a.sqlx");
  });
});

describe("background recompile", () => {
  /** Activate with fake timers and let the eager compile land. */
  async function activateFake() {
    vi.useFakeTimers();
    const context = activateAndShow();
    await vi.advanceTimersByTimeAsync(0);
    expect(compileMock).toHaveBeenCalledTimes(1);
    return context;
  }

  it("watches every file that changes the compile output, relative to the project", () => {
    activateAndShow();
    expect(lastWatcher().base).toBe("/proj");
    for (const part of [
      "definitions/**/*.sqlx",
      "definitions/**/*.js",
      "includes/**/*.js",
      "workflow_settings.yaml",
      "dataform.json",
      "package.json",
    ]) {
      expect(lastWatcher().glob).toContain(part);
    }
  });

  it("collapses a burst of file events into one recompile after the quiet period", async () => {
    await activateFake();
    lastWatcher().emitChange();
    lastWatcher().emitCreate();
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS - 100);
    lastWatcher().emitDelete();
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS - 100);
    expect(compileMock).toHaveBeenCalledTimes(1); // still waiting for quiet
    await vi.advanceTimersByTimeAsync(100);
    expect(compileMock).toHaveBeenCalledTimes(2);
  });

  it("shows 'compiling' as soon as a file changes", async () => {
    await activateFake();
    lastWatcher().emitChange();
    expect(postedOfType("compilationStatus").at(-1)).toEqual({
      type: "compilationStatus",
      status: "compiling",
    });
  });

  it("never publishes a compile that a file change superseded", async () => {
    vi.useFakeTimers();
    let release!: (v: unknown) => void;
    compileMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    activateAndShow();
    lastWatcher().emitChange(); // lands while the eager compile is still running
    const STALE = { tables: [{ target: { name: "stale" } }] };
    release(STALE);
    await vi.advanceTimersByTimeAsync(0);
    expect(postedOfType("graphUpdate")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS);
    expect(fromCompileMock).not.toHaveBeenCalledWith(STALE);
    expect(postedOfType("graphUpdate")).toEqual([{ type: "graphUpdate", graph: SERIALIZED }]);
  });

  it("keeps the last good graph when a recompile fails", async () => {
    await activateFake();
    const updates = postedOfType("graphUpdate").length;
    compileMock.mockRejectedValueOnce(new Error("definitions/a.sqlx: boom"));
    lastWatcher().emitChange();
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS);
    expect(postedOfType("compilationStatus").at(-1)).toEqual({
      type: "compilationStatus",
      status: "error",
      message: "definitions/a.sqlx: boom",
    });
    expect(postedOfType("graphUpdate")).toHaveLength(updates); // nothing replaced or cleared
    expect(records.errors).toHaveLength(0);
    expect(lastTreeView()).toMatchObject({ message: expect.stringMatching(/last good graph/) });
    // ...and the next good compile recovers.
    lastWatcher().emitChange();
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS);
    expect(postedOfType("compilationStatus").at(-1)).toEqual({
      type: "compilationStatus",
      status: "ready",
    });
    expect(lastTreeView()).toMatchObject({ message: undefined });
  });

  it("reports a missing CLI once, with a pointer to the setting", async () => {
    compileMock.mockRejectedValue(new DataformCliNotFoundError("dataform"));
    activateAndShow();
    await vi.waitFor(() =>
      expect(postedOfType("compilationStatus").at(-1)).toMatchObject({ status: "cli-missing" }),
    );
    expect(records.executed).toContainEqual(["setContext", "dataformDag.cliMissing", true]);
    expect(records.errors).toHaveLength(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), "Open Settings");
    await records.commands.get("dataformDag.refresh")!();
    await flush();
    expect(records.errors).toHaveLength(1);
  });

  it("recompiles with the new CLI when dataformDag.cliPath changes", async () => {
    await activateAndSettle();
    changeConfig("dataformDag.cliPath", "/opt/dataform");
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(2));
    expect(compileMock.mock.calls[1]).toEqual(["/proj", "/opt/dataform"]);
  });
});

describe("focusActive", () => {
  it("posts focusNode for an editor whose file maps to a node", async () => {
    activateAndShow();
    // Build first so idByPath is populated from the serialized graph.
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate").length).toBeGreaterThan(0));
    const posted = lastPanel().webview.postMessage as Mock;
    posted.mockClear();

    lastActiveEditorHandler()({ document: { uri: { fsPath: "/proj/b.sqlx" } } });
    expect(posted).toHaveBeenCalledWith({ type: "focusNode", nodeId: "b" });
  });

  it("does nothing for an unknown file or no active editor", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate").length).toBeGreaterThan(0));
    const posted = lastPanel().webview.postMessage as Mock;
    posted.mockClear();

    lastActiveEditorHandler()({ document: { uri: { fsPath: "/proj/unknown.sqlx" } } });
    lastActiveEditorHandler()(undefined);
    expect(posted).not.toHaveBeenCalled();
  });
});

describe("dispose", () => {
  it("tears down the panel so a later show() opens a fresh one", () => {
    activateAndShow();
    lastPanel().emitDispose();

    records.commands.get("dataformDag.showGraph")!();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it("keeps watching after the panel closes — the watcher belongs to the store", async () => {
    vi.useFakeTimers();
    activateAndShow();
    await vi.advanceTimersByTimeAsync(0);
    const watcher = lastWatcher();
    lastPanel().emitDispose();
    expect(watcher.dispose).not.toHaveBeenCalled();

    // The tree view still wants updates, so a change after the panel closed must still recompile.
    watcher.emitChange();
    await vi.advanceTimersByTimeAsync(RECOMPILE_DEBOUNCE_MS);
    expect(compileMock).toHaveBeenCalledTimes(2);
  });

  it("disposes the watcher when the extension's subscriptions are torn down", () => {
    const context = activateAndShow();
    const watcher = lastWatcher();
    for (const d of context.subscriptions) d.dispose();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("tag filter persistence", () => {
  it("replies to 'ready' with the filter restored from workspaceState", async () => {
    const context = fakeContext();
    context.workspaceState.get.mockReturnValue(["core", "mart"]);
    activate(context as never);
    records.commands.get("dataformDag.showGraph")!();
    lastPanel().webview.emitMessage({ type: "ready" });
    expect(postedOfType("tagFilterState")[0]).toEqual({
      type: "tagFilterState",
      selectedTags: ["core", "mart"],
    });
  });

  it("persists a filter the UI sends, without echoing it back", () => {
    const context = activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    const before = postedOfType("tagFilterState").length;
    lastPanel().webview.emitMessage({ type: "setTagFilter", selectedTags: ["core"] });
    expect(context.workspaceState.update).toHaveBeenCalledWith("dataformDag.selectedTags", ["core"]);
    // Echoing would fight the user's own clicks in the UI.
    expect(postedOfType("tagFilterState")).toHaveLength(before);
  });

  it("ignores a persisted value that is not an array of strings", async () => {
    const context = fakeContext();
    context.workspaceState.get.mockReturnValue({ nope: true });
    activate(context as never);
    records.commands.get("dataformDag.showGraph")!();
    lastPanel().webview.emitMessage({ type: "ready" });
    expect(postedOfType("tagFilterState")[0]).toEqual({ type: "tagFilterState", selectedTags: [] });
  });
});

describe("compile cache", () => {
  it("reuses one compile for the graph and a later SQL request", async () => {
    activateAndShow();
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(1));
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
    expect(compileMock).toHaveBeenCalledTimes(1); // served from cache
  });

  it("forces a recompile on the refresh command", async () => {
    await activateAndSettle();
    records.commands.get("dataformDag.refresh")!();
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(2));
  });
});

describe("compiled SQL", () => {
  it("passes the node id as the target name so a generated assertion cannot win", async () => {
    activateAndShow();
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([]);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await vi.waitFor(() => expect(findActionMock).toHaveBeenCalledTimes(1));
    expect(findActionMock.mock.calls[0][1]).toBe("definitions/a.sqlx");
    expect(findActionMock.mock.calls[0][2]).toBe("a");
  });

  it("posts the sections core produced", async () => {
    activateAndShow();
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
    expect(postedOfType("compiledSqlResult")[0]).toEqual({
      type: "compiledSqlResult",
      nodeId: "a",
      sections: [{ label: "query", sql: "SELECT 1" }],
    });
  });

  it("reports a file that produced no compiled action", async () => {
    activateAndShow();
    findActionMock.mockReturnValue(undefined);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await vi.waitFor(() => expect(postedOfType("compiledSqlError")).toHaveLength(1));
    expect(postedOfType("compiledSqlError")[0].message).toMatch(/No compiled action/);
  });

  it("reports a compile failure against the requesting node", async () => {
    compileMock.mockRejectedValue(new Error("no CLI"));
    activateAndShow();
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await vi.waitFor(() => expect(postedOfType("compiledSqlError")).toHaveLength(1));
    expect(postedOfType("compiledSqlError")[0]).toMatchObject({ nodeId: "a" });
  });

  it("drops a result whose compile was superseded by a file change", async () => {
    vi.useFakeTimers();
    let release!: (v: unknown) => void;
    compileMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    activateAndShow();
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "STALE" }]);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    // A .sqlx changes while the compile is still running, then the stale compile lands.
    lastWatcher().emitChange();
    release({ tables: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(postedOfType("compiledSqlResult")).toHaveLength(0);
  });
});

describe("showCompiledSql command", () => {
  it("warns when no editor is active", () => {
    const context = fakeContext();
    activate(context as never);
    records.commands.get("dataformDag.showCompiledSql")!();
    expect(records.warnings[0]).toMatch(/open a \.sqlx file/i);
  });

  it("warns when the file is still absent after a build", async () => {
    const context = fakeContext();
    activate(context as never);
    window.activeTextEditor = { document: { uri: Uri.file("/proj/unknown.sqlx") } };
    records.commands.get("dataformDag.showCompiledSql")!();
    // The command builds first, so the warning means "this file produced no node", not "not built yet".
    await vi.waitFor(() => expect(records.warnings.at(-1)).toMatch(/not in the graph/i));
    expect(compileMock).toHaveBeenCalled();
  });

  it("focuses the node and fetches its SQL for a known file", async () => {
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate").length).toBeGreaterThan(0));
    window.activeTextEditor = { document: { uri: Uri.file("/proj/a.sqlx") } };
    records.commands.get("dataformDag.showCompiledSql")!();
    expect(postedOfType("focusNode").at(-1)).toEqual({ type: "focusNode", nodeId: "a" });
    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
  });
});

describe("tree view commands", () => {
  /** The argument shape a tree row passes when its command fires. */
  const entry = {
    kind: "node",
    node: { id: "a", filePath: "/proj/a.sqlx", type: "table", tags: [], refs: [] },
  };

  it("opens a node's file and focuses it on the canvas", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate").length).toBeGreaterThan(0));

    records.commands.get("dataformDag.revealNode")!(entry);

    expect(records.shownDocs.at(-1)!.uri.fsPath).toBe("/proj/a.sqlx");
    expect(postedOfType("focusNode").at(-1)).toEqual({ type: "focusNode", nodeId: "a" });
  });

  it("starts from the file that was open when the panel opened, once, even if it compiles after ready", async () => {
    const context = fakeContext();
    activate(context as never);
    window.activeTextEditor = { document: { uri: Uri.file("/proj/a.sqlx") } };
    records.commands.get("dataformDag.showGraph")!();
    // The panel now covers that editor; it must have been read before.
    window.activeTextEditor = undefined;
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() =>
      expect(postedOfType("startFrom")).toEqual([{ type: "startFrom", nodeId: "a" }]),
    );
    // A recompile doesn't move the user back to where they started.
    await records.commands.get("dataformDag.refresh")!();
    await flush();
    expect(postedOfType("startFrom")).toHaveLength(1);
    expect(postedOfType("focusNode")).toEqual([]);
  });

  it("Focus in Graph opens the panel and enters focus mode only once the webview is ready", async () => {
    activate(fakeContext() as never);

    records.commands.get("dataformDag.focusInGraph")!(entry);

    // A fresh webview drops messages posted before its script loads, so nothing goes out yet.
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(postedOfType("focusLineage")).toEqual([]);

    lastPanel().webview.emitMessage({ type: "ready" });
    expect(postedOfType("focusLineage")).toEqual([{ type: "focusLineage", nodeId: "a" }]);
    // Delivered once, not again on a later ready.
    lastPanel().webview.emitMessage({ type: "ready" });
    expect(postedOfType("focusLineage")).toHaveLength(1);
  });

  it("Focus in Graph posts at once when the panel is already up", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });

    records.commands.get("dataformDag.focusInGraph")!(entry);

    expect(postedOfType("focusLineage")).toEqual([{ type: "focusLineage", nodeId: "a" }]);
  });

  it("opens the file without forcing the panel open when only the tree is in use", () => {
    const context = fakeContext();
    activate(context as never);

    records.commands.get("dataformDag.revealNode")!(entry);

    expect(records.shownDocs.at(-1)!.uri.fsPath).toBe("/proj/a.sqlx");
    expect(window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("ignores a reveal invoked with no node (e.g. from the palette)", () => {
    const context = fakeContext();
    activate(context as never);
    records.commands.get("dataformDag.revealNode")!(undefined);
    expect(window.showTextDocument).not.toHaveBeenCalled();
  });

  it("serves compiled SQL for the clicked row rather than the active editor", async () => {
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    const context = fakeContext();
    activate(context as never);
    // A different file is open — the row's node must win.
    window.activeTextEditor = { document: { uri: Uri.file("/proj/other.sqlx") } };

    records.commands.get("dataformDag.showCompiledSql")!(entry);

    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
    expect(findActionMock.mock.calls[0][1]).toBe("a.sqlx");
    expect(postedOfType("compiledSqlResult")[0]).toMatchObject({ nodeId: "a" });
  });
});

describe("showCompiledSql command, cold start", () => {
  it("builds the graph when the panel has never received 'ready'", async () => {
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    const context = fakeContext();
    activate(context as never);
    window.activeTextEditor = { document: { uri: Uri.file("/proj/a.sqlx") } };
    records.commands.get("dataformDag.showCompiledSql")!();
    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
    expect(records.warnings).toHaveLength(0);
  });
});
