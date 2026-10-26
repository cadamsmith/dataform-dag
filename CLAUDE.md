# CLAUDE.md

Constraints and hard-won invariants for this repo. See `README.md` for how it's put together and
`apps/extension/README.md` for what the extension does.

## Commands

```bash
npm install
npm run build:core   # ui + the extension depend on core's build output/types — run this first
npm run typecheck
npm test             # all workspaces (core + ui + extension)
npm run dev:ui       # shared UI standalone against a mock graph (MockBridge)
npm run watch -w dataform-dag    # extension build in watch mode; F5 "Run Extension" opens examples/starlog
npm run package -w dataform-dag  # build the .vsix
```

## Invariants — do NOT regress these (each was a real fix)

- **The extension webview is ONE non-split IIFE bundle** (`apps/extension/build.mjs`, `splitting`
  left off). A separate chunk (from any dynamic `import()`) would NOT carry the webview's CSP nonce
  and would be blocked. Keep everything inlined in the one nonce'd script.
- **Layout is dagre, synchronous** (`useLayout.ts` → `layoutGraph`). ELK was removed on purpose: it
  took ~8s on the 1,500-action `transit` example (dagre: ~0.6s) and blocked the webview meanwhile.
- **`GraphStore` is the only thing that builds a graph in the extension** (`src/graphStore.ts`). It
  owns the project watcher, the debounce, and the compile cache; the webview panel and the
  activity-bar tree are subscribers, so they can never disagree about the graph. The watcher is
  disposed with the extension, NOT with the panel — closing the panel must not stop the tree from
  updating.
- **Compiled is the only graph source, and a failed compile keeps the last good graph.** There is
  no parser fallback (it was deleted on purpose). A file event bumps `compileGeneration` at once
  and recompiles after a quiet period; any compile that finishes under an older generation must
  reach neither the cache nor a view. Failures go to the status pill / tree message, not a toast
  per save — the one toast is a missing CLI, once per session.
- **Assertion clusters and folder groups are UI-only, and the pipeline order is filter (tags →
  focus-mode lineage) → collapse folders → collapse assertions → layout**
  (`packages/ui/src/collapseFolders.ts`, `collapseAssertions.ts`, `lineage.ts`). Cluster ids
  (`assertions:<parents>`) and folder ids (`folder:<path>`) are synthetic: they name no file and
  MUST never be sent to a host — `openFile`/`showCompiledSql` always carry a real member node.
  Folder grouping is off in focus mode and under a tag filter: both are narrow views you asked for
  node by node. Collapsing before the tag filter
  would describe assertions that aren't on screen, and a group with no upstream is never collapsed
  because the filter strips refs to dropped nodes.
  Assertion clusters are listed in the detail panel and deliberately NOT expanded in place on the
  canvas: there are many small ones, and each toggle would shift the locked canvas under the click.
  Folders ARE expanded in place (double-click), level by level — the whole point of a folder is to
  open it, and dagre's relayout is fast enough. A large project (`LARGE_GRAPH` in `App.tsx`) opens
  on its top-level folders, or on a start screen when it has no folders.
- **`packages/ui` imports `@dataform-dag/core` for TYPES ONLY** (`import type`). That's what keeps
  core's Node-only modules out of the webview bundle. Don't add a value import from core to the UI.
- **Node identity = target name** (`target.name` from compile), not filename. One `.sqlx` can
  yield several actions (a table plus its inline assertions), and a file can rename itself. A name
  shared by two actions (`a.orders`, `b.orders`) is qualified to `schema.name` (or
  `database.schema.name`) for just those nodes (`nodeIdResolver` in `graphSource.ts`). Keying both
  as `orders` merged them into one node with crossed edges. Anything matching a node id back to a
  compiled action (`findCompiledActionByFile`) must accept the qualified forms.
- **React Flow nodes are locked** (`nodesDraggable={false}`); the dagre layout is authoritative.
  Dragging + interactive relayout was built and then deliberately removed (positions aren't
  persisted; relayout produced surprising crossings). Don't re-add it. Controlled RF nodes still
  MUST use `useNodesState`/`useEdgesState` + change handlers or they render frozen (React Flow #002).
