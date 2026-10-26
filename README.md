# 🔀 dataform-dag

Interactive DAG viewer for a Dataform project's dependency graph — built from `dataform compile`
run locally in the background, no warehouse connection and no cloud. Point it at any local Dataform
project that compiles. Ships as a VS Code extension built on **one shared core + one shared UI**.

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
  active editor and its node highlights.
- **Background compiling** *(extension)* — compiles as soon as a Dataform workspace opens, then
  again (debounced) whenever a `.sqlx`, a `definitions/`/`includes/` `.js`, or the project settings
  change. A failed compile keeps the last good graph on screen and says what broke. Plus a
  **Dataform DAG: Show Compiled SQL** command.

The UI talks to its host only over a `HostBridge` seam, and turns features on from the
capabilities the host advertises — the extension enables all of them.

## Layout

```
dataform-dag/
├── packages/
│   ├── core/   # pure TS: graph builder + `dataform compile --json` source and SQL extraction
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

## How the graph is built

The graph always comes from `dataform compile --json` (`CompiledGraphSource` /
`compileDataformProject` in core), so it is exactly what Dataform resolves: inline
`config.assertions`, object-form refs, and refs built in JS blocks all show up. Nodes are keyed by
**target name**, which is what `ref()` resolves against.

The CLI is found via the `dataformDag.cliPath` setting, then the project's own
`node_modules/.bin/dataform`, then `dataform` on `PATH`. A compile that fails reports its
`graphErrors` one line per file instead of the CLI's raw stderr.

## Develop

```bash
npm run typecheck
npm test             # all workspaces (core + ui + extension)
```

`CLAUDE.md` has the invariants worth not regressing; `ROADMAP.md` has what's still open.
