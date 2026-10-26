# CLAUDE.md

Constraints and hard-won invariants for this repo. See `README.md` for what the tool is and
`ROADMAP.md` for what's still open.

## Commands

```bash
npm install
npm run build:core   # ui + the extension depend on core's build output/types — run this first
npm run typecheck
npm test             # all workspaces (core + ui + extension)
npm run dev:ui       # shared UI standalone against a mock graph
```

## Invariants — do NOT regress these (each was a real fix)

- **The extension webview is ONE non-split IIFE bundle** (`apps/extension/build.mjs`, `splitting`
  left off). The shared UI lazy-`import()`s elkjs; a separate chunk would NOT carry the webview's
  CSP nonce and would be blocked → elk never runs → the graph silently falls back to dagre/bezier.
  Keep it inlined. (elkjs has no `eval`/`new Function`, so the nonce-only `script-src` runs it
  fine — don't add `'unsafe-eval'` unless a future elk version needs it.)
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
- **Assertion clusters are UI-only, and the pipeline order is filter → collapse → layout**
  (`packages/ui/src/collapseAssertions.ts`). A cluster id (`assertions:<parents>`) is synthetic: it
  names no file and MUST never be sent to a host — `openFile`/`showCompiledSql` always carry a real
  member node. Collapsing before the tag filter would describe assertions that aren't on screen, and
  a group with no upstream is never collapsed because the filter strips refs to dropped nodes.
- **`packages/ui` imports `@dataform-dag/core` for TYPES ONLY** (`import type`). That's what keeps
  core's Node-only modules out of the webview bundle. Don't add a value import from core to the UI.
- **Node identity = target name** (`target.name` from compile), not filename. One `.sqlx` can
  yield several actions (a table plus its inline assertions), and a file can rename itself.
- **React Flow nodes are locked** (`nodesDraggable={false}`); the ELK layout is authoritative.
  Dragging + interactive relayout was built and then deliberately removed (positions aren't
  persisted; relayout produced surprising crossings). Don't re-add it. Controlled RF nodes still
  MUST use `useNodesState`/`useEdgesState` + change handlers or they render frozen (React Flow #002).
