# 🔀 dataform-dag

A VS Code extension that shows a Dataform project's dependency graph as an interactive diagram. The
graph comes from `dataform compile --json`, run locally in the background: no warehouse
connection and no cloud. Any local Dataform project that compiles works.

<img alt="The DAG canvas in VS Code" src="https://github.com/user-attachments/assets/3d1dfb01-788e-4384-9f75-b36057dc909a" />

The feature list, requirements and settings live in the extension's own README,
[`apps/extension/README.md`](apps/extension/README.md), which is also its Marketplace page. This
file covers how the repo is put together.

## Layout

```
dataform-dag/
├── packages/
│   ├── core/   # pure TS: `dataform compile --json` → graph, CLI lookup, compiled-SQL extraction
│   └── ui/     # React Flow canvas, node/cluster detail, search, tag filter, talks only via HostBridge
├── apps/
│   └── extension/  # VS Code host: GraphStore (watcher + compile), webview panel, activity-bar tree
└── examples/
    └── starlog/    # a small runnable Dataform project to click through by hand
```

The UI reaches its host only through the `HostBridge` interface (`packages/ui/src/HostBridge.ts`).
In the extension that's `VsCodeBridge`, which talks `postMessage` to the webview. Under
`npm run dev:ui` it's `MockBridge`, so the canvas can be worked on in a browser without VS Code.

## How the graph is built

The graph always comes from `dataform compile --json` (`compileDataformProject` in core), so it's
exactly what Dataform resolves: inline `config.assertions`, object-form refs, and refs built in JS
blocks all show up. Nodes are keyed by **target name**, which is what `ref()` resolves against.
When two actions share a name in different schemas, just those nodes are keyed as `schema.name`.

In the extension, `GraphStore` owns the graph. It compiles when a Dataform workspace opens, and
again (debounced) after any change to a `.sqlx` file, a `.js` file under `definitions/` or
`includes/`, or the project settings. If a compile fails, the last good graph stays on screen and
the status pill says what broke. The webview and the tree view both subscribe to it.

The CLI is found via the `dataformDag.cliPath` setting, then the project's own
`node_modules/.bin/dataform`, then `dataform` on `PATH`. A compile that fails reports its
`graphErrors` one line per file instead of the CLI's raw stderr.

## Develop

```bash
npm install          # from the repo root (npm workspaces)
npm run build:core   # ui + the extension depend on core's build output — run this first
npm run typecheck
npm test             # all workspaces (core + ui + extension)
npm run dev:ui       # the shared UI alone, against a mock 18-node graph
```

To run the extension, open the repo root in VS Code and start `npm run watch -w dataform-dag`.
Then press F5 to launch the **Run Extension** configuration. The Extension Development Host opens
`examples/starlog`, and **Dataform DAG: Show Graph** draws it. `npm run package -w dataform-dag`
builds a `.vsix`. Releases go out through `.github/workflows/publish.yml`, and
[`PUBLISHING.md`](.github/workflows/PUBLISHING.md) covers the one-time setup.

`CLAUDE.md` lists the invariants that must not regress.
