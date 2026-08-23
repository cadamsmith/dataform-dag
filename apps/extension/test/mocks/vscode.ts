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

interface Records {
  commands: Map<string, (...args: unknown[]) => unknown>;
  panels: MockPanel[];
  watchers: MockWatcher[];
  activeEditorHandlers: Array<(editor: unknown) => void>;
  warnings: string[];
  errors: string[];
  shownDocs: Array<{ uri: MockUri; opts: unknown }>;
}

export const records: Records = {
  commands: new Map(),
  panels: [],
  watchers: [],
  activeEditorHandlers: [],
  warnings: [],
  errors: [],
  shownDocs: [],
};

/** Convenience accessors for the most-recently created objects. */
export const lastPanel = (): MockPanel => records.panels[records.panels.length - 1];
export const lastWatcher = (): MockWatcher => records.watchers[records.watchers.length - 1];
export const lastActiveEditorHandler = (): ((editor: unknown) => void) =>
  records.activeEditorHandlers[records.activeEditorHandlers.length - 1];

/** Reset all recorded state between tests. `workspaceFolders` is mutated directly by tests. */
export function resetMock(): void {
  records.commands.clear();
  records.panels.length = 0;
  records.watchers.length = 0;
  records.activeEditorHandlers.length = 0;
  records.warnings.length = 0;
  records.errors.length = 0;
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
  onDidChangeActiveTextEditor: (cb: (editor: unknown) => void) => MockDisposable;
  showWarningMessage: (msg: string) => Promise<undefined>;
  showErrorMessage: (msg: string) => Promise<undefined>;
  showTextDocument: (u: MockUri, opts: unknown) => Promise<undefined>;
} = {
  activeTextEditor: undefined,
  createWebviewPanel: vi.fn((_id: string, _title: string, _col: number, _opts: unknown) => {
    const panel = new MockPanel();
    records.panels.push(panel);
    return panel;
  }),
  onDidChangeActiveTextEditor(cb: (editor: unknown) => void): MockDisposable {
    records.activeEditorHandlers.push(cb);
    return { dispose: vi.fn() };
  },
  showWarningMessage: vi.fn((msg: string) => {
    records.warnings.push(msg);
    return Promise.resolve(undefined);
  }),
  showErrorMessage: vi.fn((msg: string) => {
    records.errors.push(msg);
    return Promise.resolve(undefined);
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
};

export const workspace: {
  workspaceFolders: WorkspaceFolder[] | undefined;
  createFileSystemWatcher: (glob: string) => MockWatcher;
} = {
  workspaceFolders: undefined,
  createFileSystemWatcher: vi.fn((glob: string) => {
    const w = new MockWatcher();
    w.glob = glob;
    records.watchers.push(w);
    return w;
  }),
};

export const Uri = {
  file: (p: string): MockUri => uri(p),
  joinPath: (base: MockUri, ...segments: string[]): MockUri =>
    uri([base.fsPath, ...segments].join("/")),
};

export const ViewColumn = { Active: -1, One: 1 } as const;

export class Disposable {
  dispose(): void {
    /* noop */
  }
}
