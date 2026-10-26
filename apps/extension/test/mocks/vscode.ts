// A hand-rolled `vscode` module stub. The real `vscode` namespace is injected by the VS Code host at
// runtime and is NOT an installed package (we only have `@types/vscode`), so tests alias the bare
// `vscode` specifier to this file (see vitest.config.ts). Everything the extension touches is recorded
// here so tests can drive the registered callbacks and assert on host interactions.
import { vi } from "vitest";

interface MockUri {
  fsPath: string;
  scheme: string;
  toString(): string;
}

function uri(fsPath: string, scheme = "file"): MockUri {
  return { fsPath, scheme, toString: () => fsPath };
}

class MockWebview {
  html = "";
  readonly cspSource = "vscode-webview://mock";
  readonly postMessage = vi.fn((_msg: unknown) => Promise.resolve(true));
  private readonly receiveHandlers: Array<(msg: unknown) => void> = [];

  onDidReceiveMessage(
    cb: (msg: unknown) => void,
    _thisArg?: unknown,
    disposables?: MockDisposable[],
  ): MockDisposable {
    this.receiveHandlers.push(cb);
    const d = { dispose: vi.fn() };
    disposables?.push(d);
    return d;
  }

  /** Simulate a message arriving from the webview UI. */
  emitMessage(msg: unknown): void {
    for (const h of this.receiveHandlers) h(msg);
  }

  asWebviewUri(u: MockUri): MockUri {
    return u;
  }
}

class MockPanel {
  readonly webview = new MockWebview();
  readonly reveal = vi.fn();
  readonly dispose = vi.fn(() => this.emitDispose());
  private readonly disposeHandlers: Array<() => void> = [];

  onDidDispose(cb: () => void, _thisArg?: unknown, disposables?: MockDisposable[]): MockDisposable {
    this.disposeHandlers.push(cb);
    const d = { dispose: vi.fn() };
    disposables?.push(d);
    return d;
  }

  /** Simulate the user closing the panel. */
  emitDispose(): void {
    for (const h of this.disposeHandlers.splice(0)) h();
  }
}

class MockWatcher {
  glob = "";
  base: string | undefined;
  readonly dispose = vi.fn();
  private readonly change: Array<() => void> = [];
  private readonly create: Array<() => void> = [];
  private readonly del: Array<() => void> = [];

  onDidChange(cb: () => void, _t?: unknown, d?: MockDisposable[]): MockDisposable {
    return this.register(this.change, cb, d);
  }
  onDidCreate(cb: () => void, _t?: unknown, d?: MockDisposable[]): MockDisposable {
    return this.register(this.create, cb, d);
  }
  onDidDelete(cb: () => void, _t?: unknown, d?: MockDisposable[]): MockDisposable {
    return this.register(this.del, cb, d);
  }
  private register(
    bucket: Array<() => void>,
    cb: () => void,
    disposables?: MockDisposable[],
  ): MockDisposable {
    bucket.push(cb);
    const disp = { dispose: vi.fn() };
    disposables?.push(disp);
    return disp;
  }

  emitChange(): void {
    for (const h of this.change) h();
  }
  emitCreate(): void {
    for (const h of this.create) h();
  }
  emitDelete(): void {
    for (const h of this.del) h();
  }
}

interface MockDisposable {
  dispose: () => void;
}

interface WorkspaceFolder {
  uri: { fsPath: string };
}

interface MockTreeView {
  id: string;
  provider: MockTreeDataProvider;
  dispose: () => void;
}

/** The slice of `TreeDataProvider` the tests drive — enough to walk the tree the provider builds. */
interface MockTreeDataProvider {
  getTreeItem: (element: unknown) => unknown;
  getChildren: (element?: unknown) => unknown;
}

interface Records {
  commands: Map<string, (...args: unknown[]) => unknown>;
  panels: MockPanel[];
  watchers: MockWatcher[];
  treeViews: MockTreeView[];
  activeEditorHandlers: Array<(editor: unknown) => void>;
  warnings: string[];
  errors: string[];
  /** Every `commands.executeCommand` call, e.g. `["setContext", key, value]`. */
  executed: unknown[][];
  /** The workspace configuration `getConfiguration().get(key)` reads. */
  config: Map<string, unknown>;
  configHandlers: Array<(e: { affectsConfiguration: (key: string) => boolean }) => void>;
  shownDocs: Array<{ uri: MockUri; opts: unknown }>;
}

export const records: Records = {
  commands: new Map(),
  panels: [],
  watchers: [],
  treeViews: [],
  activeEditorHandlers: [],
  warnings: [],
  errors: [],
  executed: [],
  config: new Map(),
  configHandlers: [],
  shownDocs: [],
};

/** Convenience accessors for the most-recently created objects. */
export const lastPanel = (): MockPanel => records.panels[records.panels.length - 1];
export const lastWatcher = (): MockWatcher => records.watchers[records.watchers.length - 1];
export const lastTreeView = (): MockTreeView => records.treeViews[records.treeViews.length - 1];
export const lastActiveEditorHandler = (): ((editor: unknown) => void) =>
  records.activeEditorHandlers[records.activeEditorHandlers.length - 1];

/** Simulate the user changing a setting: update it and notify `onDidChangeConfiguration`. */
export function changeConfig(key: string, value: unknown): void {
  records.config.set(key, value);
  for (const h of records.configHandlers) h({ affectsConfiguration: (k) => k === key });
}

/** Reset all recorded state between tests. `workspaceFolders` is mutated directly by tests. */
export function resetMock(): void {
  records.commands.clear();
  records.panels.length = 0;
  records.watchers.length = 0;
  records.treeViews.length = 0;
  records.activeEditorHandlers.length = 0;
  records.warnings.length = 0;
  records.errors.length = 0;
  records.executed.length = 0;
  records.config.clear();
  records.configHandlers.length = 0;
  records.shownDocs.length = 0;
  workspace.workspaceFolders = undefined;
  window.activeTextEditor = undefined;
  vi.clearAllMocks();
}

/** A `workspaceState`-shaped memento backed by a plain Map, for the fake ExtensionContext. */
export function makeMemento(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn((key: string) => store.get(key)),
    update: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    keys: () => [...store.keys()],
  };
}

export const window: {
  activeTextEditor: { document: { uri: MockUri } } | undefined;
  createWebviewPanel: (id: string, title: string, col: number, opts: unknown) => MockPanel;
  createTreeView: (id: string, opts: { treeDataProvider: MockTreeDataProvider }) => MockTreeView;
  onDidChangeActiveTextEditor: (cb: (editor: unknown) => void) => MockDisposable;
  showWarningMessage: (msg: string) => Promise<undefined>;
  showErrorMessage: (msg: string, ...items: string[]) => Promise<string | undefined>;
  showTextDocument: (u: MockUri, opts: unknown) => Promise<undefined>;
} = {
  activeTextEditor: undefined,
  createWebviewPanel: vi.fn((_id: string, _title: string, _col: number, _opts: unknown) => {
    const panel = new MockPanel();
    records.panels.push(panel);
    return panel;
  }),
  createTreeView: vi.fn((id: string, opts: { treeDataProvider: MockTreeDataProvider }) => {
    const view: MockTreeView = { id, provider: opts.treeDataProvider, dispose: vi.fn() };
    records.treeViews.push(view);
    return view;
  }),
  onDidChangeActiveTextEditor(cb: (editor: unknown) => void): MockDisposable {
    records.activeEditorHandlers.push(cb);
    return { dispose: vi.fn() };
  },
  showWarningMessage: vi.fn((msg: string) => {
    records.warnings.push(msg);
    return Promise.resolve(undefined);
  }),
  showErrorMessage: vi.fn((msg: string, ..._items: string[]) => {
    records.errors.push(msg);
    return Promise.resolve<string | undefined>(undefined);
  }),
  showTextDocument: vi.fn((u: MockUri, opts: unknown) => {
    records.shownDocs.push({ uri: u, opts });
    return Promise.resolve(undefined);
  }),
};

export const commands = {
  registerCommand: vi.fn((id: string, cb: (...args: unknown[]) => unknown) => {
    records.commands.set(id, cb);
    return { dispose: vi.fn() };
  }),
  executeCommand: vi.fn((...args: unknown[]) => {
    records.executed.push(args);
    return Promise.resolve(undefined);
  }),
};

export class RelativePattern {
  constructor(
    public readonly base: WorkspaceFolder,
    public readonly pattern: string,
  ) {}
}

export const workspace: {
  workspaceFolders: WorkspaceFolder[] | undefined;
  createFileSystemWatcher: (glob: string | RelativePattern) => MockWatcher;
  getConfiguration: () => { get: <T>(key: string) => T | undefined };
  onDidChangeConfiguration: (
    cb: (e: { affectsConfiguration: (key: string) => boolean }) => void,
    thisArg?: unknown,
    disposables?: MockDisposable[],
  ) => MockDisposable;
} = {
  workspaceFolders: undefined,
  createFileSystemWatcher: vi.fn((glob: string | RelativePattern) => {
    const w = new MockWatcher();
    if (typeof glob === "string") w.glob = glob;
    else {
      w.glob = glob.pattern;
      w.base = glob.base.uri.fsPath;
    }
    records.watchers.push(w);
    return w;
  }),
  getConfiguration: () => ({ get: <T>(key: string) => records.config.get(key) as T | undefined }),
  onDidChangeConfiguration(cb, _thisArg, disposables) {
    records.configHandlers.push(cb);
    const d = { dispose: vi.fn() };
    disposables?.push(d);
    return d;
  },
};

export const Uri = {
  file: (p: string): MockUri => uri(p),
  joinPath: (base: MockUri, ...segments: string[]): MockUri =>
    uri([base.fsPath, ...segments].join("/")),
};

export const ViewColumn = { Active: -1, One: 1 } as const;

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** A real class, not a spy: the provider tests assert on the items it hands back. */
export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  resourceUri?: MockUri;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    public readonly label: string,
    public readonly collapsibleState: number = TreeItemCollapsibleState.None,
  ) {}
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  constructor(public readonly value: string) {}
}

export class Disposable {
  dispose(): void {
    /* noop */
  }
}

/**
 * A working stand-in for `vscode.EventEmitter` — the store publishes graph/mode/status changes
 * through these, so the tests need real fan-out, not a spy. `event` is a bound property because
 * consumers pass it around detached (`store.onDidChangeGraph`).
 */
export class EventEmitter<T> {
  private readonly handlers = new Set<(e: T) => void>();

  readonly event = (
    cb: (e: T) => void,
    _thisArg?: unknown,
    disposables?: MockDisposable[],
  ): MockDisposable => {
    this.handlers.add(cb);
    const d = { dispose: vi.fn(() => this.handlers.delete(cb)) };
    disposables?.push(d);
    return d;
  };

  fire(e: T): void {
    for (const h of [...this.handlers]) h(e);
  }

  dispose(): void {
    this.handlers.clear();
  }
}
