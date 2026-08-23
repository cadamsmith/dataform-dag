import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { activate } from "../src/extension.js";
import {
  Uri,
  ViewColumn,
  commands,
  lastActiveEditorHandler,
  lastPanel,
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
  NodeFileSource: class {
    constructor(public readonly root: string) {}
  },
  buildGraphFromWorkspace: vi.fn(),
  serializeGraph: vi.fn(),
  compileDataformProject: vi.fn(),
  graphFromCompileOutput: vi.fn(),
  findCompiledActionByFile: vi.fn(),
  compiledSqlSections: vi.fn(),
}));
import {
  buildGraphFromWorkspace,
  compileDataformProject,
  compiledSqlSections,
  findCompiledActionByFile,
  graphFromCompileOutput,
  serializeGraph,
} from "@dataform-dag/core";

const buildMock = buildGraphFromWorkspace as unknown as Mock;
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

beforeEach(() => {
  resetMock();
  buildMock.mockReset();
  serializeMock.mockReset();
  buildMock.mockResolvedValue({ nodes: new Map(), edges: [] });
  serializeMock.mockReturnValue(SERIALIZED);
  compileMock.mockReset();
  fromCompileMock.mockReset();
  findActionMock.mockReset();
  sectionsMock.mockReset();
  workspace.workspaceFolders = [{ uri: { fsPath: "/proj" } }];
});

describe("activate", () => {
  it("registers the showGraph command and pushes disposables", () => {
    const context = activateAndShow();
    expect(commands.registerCommand).toHaveBeenCalledWith(
      "dataformDag.showGraph",
      expect.any(Function),
    );
    expect(commands.registerCommand).toHaveBeenCalledWith(
      "dataformDag.showCompiledSql",
      expect.any(Function),
    );
    // two command disposables + the controller itself
    expect(context.subscriptions).toHaveLength(3);
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

  it("rebuilds on 'requestRefresh'", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "requestRefresh" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(lastPanel().webview.postMessage).toHaveBeenCalledWith({
      type: "graphUpdate",
      graph: SERIALIZED,
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
    expect(buildMock).not.toHaveBeenCalled();
    // `ready` still replies with the restored filter and mode; only the graph is withheld.
    expect(postedOfType("graphUpdate")).toHaveLength(0);
  });

  it("surfaces a build failure as an error message without crashing", async () => {
    buildMock.mockRejectedValueOnce(new Error("boom"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(records.errors).toHaveLength(1));
    expect(records.errors[0]).toMatch(/boom/);
    expect(postedOfType("graphUpdate")).toHaveLength(0);
  });

  it("builds from the first workspace folder's path", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(buildMock.mock.calls[0][0]).toMatchObject({ root: "/proj" });
  });
});

describe("watcher wiring", () => {
  it("watches **/*.sqlx and rebuilds on change, create, and delete", async () => {
    activateAndShow();
    expect(lastWatcher().glob).toBe("**/*.sqlx");

    lastWatcher().emitChange();
    lastWatcher().emitCreate();
    lastWatcher().emitDelete();

    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(3));
  });
});

describe("focusActive", () => {
  it("posts focusNode for an editor whose file maps to a node", async () => {
    activateAndShow();
    // Build first so idByPath is populated from the serialized graph.
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalled());
    const posted = lastPanel().webview.postMessage as Mock;
    posted.mockClear();

    lastActiveEditorHandler()({ document: { uri: { fsPath: "/proj/b.sqlx" } } });
    expect(posted).toHaveBeenCalledWith({ type: "focusNode", nodeId: "b" });
  });

  it("does nothing for an unknown file or no active editor", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalled());
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
    const watcher = lastWatcher();
    lastPanel().emitDispose();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);

    records.commands.get("dataformDag.showGraph")!();
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
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

describe("compiled mode", () => {
  const OUTPUT = { tables: [] };

  beforeEach(() => {
    compileMock.mockResolvedValue(OUTPUT);
    fromCompileMock.mockReturnValue({ nodes: new Map(), downstreamMap: new Map(), issues: [] });
    serializeMock.mockReturnValue({
      nodes: [{ id: "a", filePath: "definitions/a.sqlx" }],
      downstream: [],
      issues: [],
    });
  });

  it("compiles instead of parsing once the mode is switched", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "setGraphMode", mode: "compiled" });
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(1));
    expect(compileMock).toHaveBeenCalledWith("/proj");
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("resolves compiled relative paths against the workspace root", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "setGraphMode", mode: "compiled" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(1));
    const update = postedOfType("graphUpdate")[0] as { graph: { nodes: Array<{ filePath: string }> } };
    expect(update.graph.nodes[0].filePath).toBe("/proj/definitions/a.sqlx");
  });

  it("reuses one compile for the graph and a later SQL request", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "setGraphMode", mode: "compiled" });
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(1));
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    lastPanel().webview.emitMessage({
      type: "showCompiledSql",
      nodeId: "a",
      filePath: "/proj/definitions/a.sqlx",
    });
    await flush();
    expect(compileMock).toHaveBeenCalledTimes(1); // served from cache
  });

  it("recompiles after a .sqlx change invalidates the cache", async () => {
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "setGraphMode", mode: "compiled" });
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(1));
    lastWatcher().emitChange();
    await vi.waitFor(() => expect(compileMock).toHaveBeenCalledTimes(2));
  });

  it("falls back to parsed mode and reports the failure when compilation throws", async () => {
    compileMock.mockRejectedValueOnce(new Error("no CLI"));
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "setGraphMode", mode: "compiled" });
    await vi.waitFor(() => expect(records.errors).toHaveLength(1));
    expect(records.errors[0]).toMatch(/could not compile/i);
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(postedOfType("graphModeState").at(-1)).toEqual({
      type: "graphModeState",
      mode: "parsed",
    });
  });
});

describe("compiled SQL", () => {
  beforeEach(() => {
    compileMock.mockResolvedValue({ tables: [] });
  });

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
    compileMock.mockRejectedValueOnce(new Error("no CLI"));
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
    await flush();
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
    expect(buildMock).toHaveBeenCalled();
  });

  it("focuses the node and fetches its SQL for a known file", async () => {
    compileMock.mockResolvedValue({ tables: [] });
    findActionMock.mockReturnValue({ target: { name: "a" } });
    sectionsMock.mockReturnValue([{ label: "query", sql: "SELECT 1" }]);
    activateAndShow();
    lastPanel().webview.emitMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedOfType("graphUpdate")).toHaveLength(1));
    window.activeTextEditor = { document: { uri: Uri.file("/proj/a.sqlx") } };
    records.commands.get("dataformDag.showCompiledSql")!();
    expect(postedOfType("focusNode").at(-1)).toEqual({ type: "focusNode", nodeId: "a" });
    await vi.waitFor(() => expect(postedOfType("compiledSqlResult")).toHaveLength(1));
  });
});

describe("showCompiledSql command, cold start", () => {
  it("builds the graph when the panel has never received 'ready'", async () => {
    compileMock.mockResolvedValue({ tables: [] });
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
