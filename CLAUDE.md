# CLAUDE.md

Constraints and hard-won invariants for this repo. See `README.md` for what the tool is and
`ROADMAP.md` for what's still open.

## Commands

```bash
npm install
npm run build:core   # ui + both hosts depend on core's build output/types — run this first
npm run typecheck
npm test             # all workspaces (core + ui + extension + web)
npm run dev:ui       # shared UI standalone against a mock graph
```

## Invariants — do NOT regress these (each was a real fix)

- **The extension webview is ONE non-split IIFE bundle** (`apps/extension/build.mjs`, `splitting`
  left off). The shared UI lazy-`import()`s elkjs; a separate chunk would NOT carry the webview's
  CSP nonce and would be blocked → elk never runs → the graph silently falls back to dagre/bezier.
  Keep it inlined. (elkjs has no `eval`/`new Function`, so the nonce-only `script-src` runs it
  fine — don't add `'unsafe-eval'` unless a future elk version needs it.)
- **`@dataform-dag/core/browser` is the browser-safe entry** (parser + graph only). The main barrel
  (`.`) re-exports `NodeFileSource` (`node:fs`) and `CompiledGraphSource` (`node:child_process`),
  which break a browser bundle. The web host imports from `/browser`. Don't route browser code
  through `.`.
- **`packages/ui` imports `@dataform-dag/core` for TYPES ONLY** (`import type`). That's what keeps
  core's Node-only modules out of both UI bundles. Don't add a value import from core to the UI.
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
- **The web host is local-only, by choice.** It's a static bundle run locally (`npm run dev -w
  @dataform-dag/web`) that exists for local use and as the standalone proving ground for the shared
  UI. Don't wire up GitHub Pages / Vercel / Netlify or any other hosting.
