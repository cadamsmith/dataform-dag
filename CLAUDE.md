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
  owns the `**/*.sqlx` watcher, the compile cache, and the authoritative `GraphMode`; the webview
  panel and the activity-bar tree are subscribers. Two views computing their own graphs would
  disagree the moment one switched to compiled mode (16 nodes vs 24). The watcher is disposed with
  the extension, NOT with the panel — closing the panel must not stop the tree from updating.
- **Assertion clusters are UI-only, and the pipeline order is filter → collapse → layout**
  (`packages/ui/src/collapseAssertions.ts`). A cluster id (`assertions:<parents>`) is synthetic: it
  names no file and MUST never be sent to a host — `openFile`/`showCompiledSql` always carry a real
  member node. Collapsing before the tag filter would describe assertions that aren't on screen, and
  a group with no upstream is never collapsed because the filter strips refs to dropped nodes.
- **`@dataform-dag/core/browser` is the browser-safe entry** (parser + graph only). The main barrel
  (`.`) re-exports `NodeFileSource` (`node:fs`) and `CompiledGraphSource` (`node:child_process`),
  which break a browser bundle. Don't route browser code through `.`.
- **`packages/ui` imports `@dataform-dag/core` for TYPES ONLY** (`import type`). That's what keeps
  core's Node-only modules out of the webview bundle. Don't add a value import from core to the UI.
- **Node identity = target name** (`config.name ?? basename`), not filename. Both graph sources key
  on it so their outputs are interchangeable. (A file can rename itself — e.g. a declaration.)
- **React Flow nodes are locked** (`nodesDraggable={false}`); the ELK layout is authoritative.
  Dragging + interactive relayout was built and then deliberately removed (positions aren't
  persisted; relayout produced surprising crossings). Don't re-add it. Controlled RF nodes still
  MUST use `useNodesState`/`useEdgesState` + change handlers or they render frozen (React Flow #002).
- **The regex tier emits one node per file** (16 on the fixture); `dataform compile` emits more (24)
  — the extra 8 are inline `config.assertions` that Dataform synthesizes. This is the documented
  tier boundary, pinned by a golden `compile --json` fixture in `packages/core/test`, NOT a bug to
  "fix" in the regex parser.
