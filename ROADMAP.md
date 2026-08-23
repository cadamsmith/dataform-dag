# ROADMAP

What's still open. Hard constraints live in `CLAUDE.md`; what the tool *is* lives in `README.md`.
Anything not listed here is either done (`git log`) or deliberately out of scope.

## Open

- **Cut the first release.** The extension packages cleanly (`npm run package` → a ~747 KB
  `.vsix`), and `.github/workflows/publish.yml` pushes to both the VS Marketplace and Open VSX on a
  tagged GitHub Release — but there are no tags yet and the one-time setup in
  `.github/workflows/PUBLISHING.md` (two repo secrets, a registered publisher on each registry)
  hasn't been done. That setup is credentialed and has to be the user's step.
- **Human smoke test.** Everything a machine can check is green (146 tests, typecheck, both hosts
  build, `.vsix` packages). Nobody has confirmed with their eyes that (a) the packaged `.vsix`
  installs into a real VS Code and renders, (b) the activity-bar icon shows up and its tree opens
  files and reflects rebuilds, or (c) the web host renders in Chrome/Edge after picking a folder.
  Until then "renders correctly" is inferred from build success, not observed.
- **Tree view: reveal the active editor's node.** The canvas highlights the node for the active
  editor; the tree doesn't. `TreeView.reveal()` needs `DagTreeProvider.getParent()` plus stable
  `TreeItem.id`s, since the provider rebuilds its entries on every `getChildren`.
- **Web host: let the user re-pick the project folder.** `apps/web/src/main.tsx` gates once on a
  directory pick and never offers a way back — switching projects means reloading the page.
- **UI: collapse-by-layer.** Search, tag filtering, and the SQL preview shipped; collapsing a whole
  layer/tag group did not.

## Decided, not open

- `packages/ui/src/index.ts` exports `layoutGraph` (the dagre layout). Nothing outside the package
  imports it — it's live only as the runtime fallback inside `useLayout`, and the tests reach it
  through `../src/graphToFlow.js` directly. It can drop from the public barrel whenever someone is
  touching that file; not worth a commit of its own.
