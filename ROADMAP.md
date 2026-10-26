# ROADMAP

What's still open. Hard constraints live in `CLAUDE.md`; what the tool *is* lives in `README.md`.
Anything not listed here is either done (`git log`) or deliberately out of scope.

## Open

- **Cut the first release.** The extension packages cleanly (`npm run package` → a ~747 KB
  `.vsix`), and `.github/workflows/publish.yml` pushes to both the VS Marketplace and Open VSX on a
  tagged GitHub Release — but there are no tags yet and the one-time setup in
  `.github/workflows/PUBLISHING.md` (two repo secrets, a registered publisher on each registry)
  hasn't been done. That setup is credentialed and has to be the user's step.
- **Human smoke test.** Everything a machine can check is green (tests, typecheck, the extension
  builds, `.vsix` packages). Nobody has confirmed with their eyes that (a) the packaged `.vsix`
  installs into a real VS Code and renders, (b) the activity-bar icon shows up and its tree opens
  files and reflects rebuilds.
  Until then "renders correctly" is inferred from build success, not observed.
- **Tree view: reveal the active editor's node.** The canvas highlights the node for the active
  editor; the tree doesn't. `TreeView.reveal()` needs `DagTreeProvider.getParent()` plus stable
  `TreeItem.id`s, since the provider rebuilds its entries on every `getChildren`.
- **UI: collapse-by-layer.** Search, tag filtering, the SQL preview, and assertion grouping shipped;
  collapsing a whole layer/tag group did not.
- **Expand a cluster in place on the canvas.** Grouped assertions are listed in the detail panel,
  deliberately not expanded on the canvas: that needs an `expanded` set, a full ELK relayout per
  toggle (slow on a large project), and the canvas would shift under the click since nodes are
  locked. `collapseAssertions` takes a `minGroupSize` and returns its `members`/`clusterOf` maps, so
  the transform is ready for it whenever the relayout cost is worth paying.
- **The rest of the large-project story.** Assertion grouping was the first cut at a graph that is
  too big to read. Not yet measured or addressed: ELK layout time and React Flow's DOM node count on
  a project with hundreds of actions.

## Decided, not open

- `packages/ui/src/index.ts` exports `layoutGraph` (the dagre layout). Nothing outside the package
  imports it — it's live only as the runtime fallback inside `useLayout`, and the tests reach it
  through `../src/graphToFlow.js` directly. It can drop from the public barrel whenever someone is
  touching that file; not worth a commit of its own.
