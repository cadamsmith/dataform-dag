# 🔀 dataform-dag

Interactive DAG viewer for a Dataform project's dependency graph — parsed locally from `.sqlx`
files, no warehouse connection and no cloud. Point it at any local Dataform project (one with a
`definitions/**/*.sqlx` tree). Ships as a VS Code extension built
on **one shared core + one shared UI**.

<img alt="The DAG canvas in VS Code" src="https://github.com/user-attachments/assets/3d1dfb01-788e-4384-9f75-b36057dc909a" />

## What it does

- **The whole graph at a glance** — every source, table, view, incremental, assertion, and operation,
  laid out left-to-right by dependency with a color-coded legend and a minimap.
- **Assertion grouping** — assertions sharing the same dependencies collapse into one "N
  assertions" node, with a panel listing each one; a large compiled graph is mostly assertion leaves
  without it. Toggleable from the toolbar.
- **Search and tag filtering** — jump to a node by name, or narrow the canvas to one or more
  Dataform `tags`.
- **Node detail** — type, tags, file path, and upstream/downstream refs, plus the compiled SQL for
  that node on hosts that can compile *(extension)*.
- **Diagnostics** — unresolved `ref()`s and duplicate node ids surfaced as a panel instead of
  silently dropped edges.
- **An activity-bar tree** *(extension)* — every action grouped by type in the sidebar, with tags
  and a click straight to the file, whether or not the canvas is open.
- **Click through to code, live** *(extension)* — click a node to open its `.sqlx`; switch the
  active editor and its node highlights; save any `.sqlx` and the graph rebuilds.
- **Compiled mode** *(extension)* — toggle from the regex parser to `dataform compile --json` for a
  higher-fidelity graph, plus a **Dataform DAG: Show Compiled SQL** command. Falls back to the
  parsed graph if the CLI is missing or the project doesn't compile.

The UI talks to its host only over a `HostBridge` seam, and turns features on from the
capabilities the host advertises — the extension enables all of them.

## Layout

```
dataform-dag/
├── packages/
│   ├── core/   # pure TS: .sqlx parser + graph builder + graph sources (regex | compile)
│   └── ui/     # host-agnostic React Flow canvas + node detail, talks only via HostBridge
├── apps/
│   └── extension/  # VS Code host — webview + FileSystemWatcher, HostBridge over postMessage
└── examples/
    └── starlog/    # a small runnable Dataform project to click through by hand
```

## Quickstart

```bash
npm install          # from the repo root (npm workspaces)
npm run build:core   # everything else depends on core's build output — run this first
```

Then:

```bash
# VS Code extension: open the repo root in VS Code, build with `npm run watch -w dataform-dag`,
# press F5, and run "Dataform DAG: Show Graph" in the Extension Development Host (see
# apps/extension/README.md). It opens examples/starlog, a project that's already set up.

npm run dev:ui                     # the shared UI alone, against a mock 18-node graph
```

## Parsing strategy: layered graph sources

The core exposes a `GraphSource` seam so the *same* `DataformGraph` can be produced two ways:

- **`ParsedGraphSource`** (default) — a lightweight regex parser over `.sqlx` text. No
  `@dataform/core` dependency, runs in the browser, works on a project that doesn't compile.
- **`CompiledGraphSource`** (opt-in, Node only) — shells out to `dataform compile --json` and maps
  the resolved graph. Higher fidelity (catches inline `config.assertions`, object-form refs, refs
  built in JS blocks) at the cost of requiring the CLI and a compiling project. The extension
  exposes this as the in-canvas mode toggle.

Both key nodes by **target name** (`config.name ?? filename`), so their output is interchangeable.

Known regex-tier limitations (by design — use compiled mode when they matter): inline
`config.assertions` are not materialized as separate nodes, and a `ref()` inside a **commented-out**
line of SQL is still counted as a dependency (config-block comments *are* stripped; SQL-body comments
are not). Both are covered by tests so they stay documented boundaries, not surprises.

## Develop

```bash
npm run typecheck
npm test             # all workspaces (core + ui + extension)
```

`CLAUDE.md` has the invariants worth not regressing; `ROADMAP.md` has what's still open.
