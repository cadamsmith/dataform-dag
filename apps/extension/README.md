# 🔀 dataform-dag

Explore your [Dataform](https://cloud.google.com/dataform) project's dependency graph as an interactive diagram,
right inside VS Code. The graph comes straight from `dataform compile`, run locally in the
background — **no warehouse connection and no cloud**, and exactly the graph Dataform itself sees,
including inline assertions and refs built in JavaScript.

<img alt="image" src="https://github.com/user-attachments/assets/3d1dfb01-788e-4384-9f75-b36057dc909a" />

## Features

- **See the whole graph at a glance.** Every model, source, view, and assertion in your project,
  laid out left-to-right by dependency with a color-coded legend and a minimap for large projects.
- **Stay readable at scale.** Assertions that hang off the same models collapse into a single
  "N assertions" node — click it to list them, with each one's file and compiled SQL still one click
  away. A large project opens with each folder collapsed into one node; double-click a folder to
  open it.
- **Find anything fast.** Search nodes by name, or filter the canvas down to one or more Dataform
  `tags` — the node count in the top bar tracks what's visible. Turn on **Show neighbors** to keep
  each match's direct upstream and downstream in view, drawn dashed so the matches still stand out.
- **Inspect a node.** Click one for its type, tags, file path, and upstream/downstream refs — and
  the SQL Dataform actually compiles it to.
- **Focus on one node's lineage.** Double-click a node, press **Focus** in its detail panel, or click
  the target icon on a row in the sidebar, and the canvas shows only that node plus everything
  upstream and downstream of it. A stepper narrows it to 1, 2, 3… hops each way; Esc or
  **Exit focus** brings the whole graph back.
- **Share a diagram.** **Copy as Mermaid** puts the view on screen on the clipboard as a Mermaid
  flowchart, ready to paste into Markdown on GitHub, GitLab, or Notion. Filters, focus mode, and
  open folders (as nested subgraphs) carry over, so narrow the view first: Mermaid stops rendering
  past 500 edges, and the button says so when an export is that big.
- **Navigate refs in the editor.** Cmd/Ctrl-click a `ref("…")`, a `resolve(…)`, or a
  `dependencies` entry to jump to the action it names, and hover one to see its type,
  description, and how many nodes sit up- and downstream of it. A lens over each action shows its
  upstream/downstream counts; click it to open that action's lineage in the graph.
- **Browse from the sidebar.** The Dataform DAG icon in the activity bar lists every action in the
  project grouped by type — sources, tables, views, incrementals, assertions, operations — or, from
  the view's title bar, by the folder its file lives in, with each one's tags beside it. Click a row to open its file; the canvas follows along when it's open.
- **Jump straight to the code.** Click through to open a node's `.sqlx` file in the editor.
- **Follow along as you navigate.** Switch the active editor to a modeled file and its node is
  highlighted on the canvas.
- **Live updates.** Save a `.sqlx`, a `.js` in `definitions/` or `includes/`, or the project
  settings and the project recompiles in the background — a burst of saves compiles once. If a save
  breaks the build, the last good graph stays on screen and the toolbar says what failed. A
  `ref()` to something that doesn't exist counts as a failed build.
- **Same name, different schema.** Two actions that share a name, like `staging.orders` and
  `marts.orders`, stay separate nodes, labelled with their schema.

## Getting started

1. Open a Dataform project folder in VS Code (one with a `workflow_settings.yaml` or
   `dataform.json`). The extension starts compiling it right away.
2. Click the **Dataform DAG** icon in the activity bar to browse your actions, or open the Command
   Palette (`Cmd`/`Ctrl` + `Shift` + `P`) and run **Dataform DAG: Show Graph** for the canvas.
3. Click any node to open its file; edit and save to see the graph update.

There's a second command, **Dataform DAG: Show Compiled SQL**: run it while editing a `.sqlx` and
the graph opens focused on that file's node, with its compiled SQL in the detail panel.

## Node types

The legend across the top color-codes each node by its Dataform type:

**source** · **table** · **view** · **incremental** · **assertion** · **operations**

## Requirements

- VS Code `1.90.0` or newer.
- A Dataform project that compiles.
- The [Dataform CLI](https://cloud.google.com/dataform/docs/use-dataform-cli). The extension uses,
  in order: the `dataformDag.cliPath` setting, the project's own `node_modules/.bin/dataform`, then
  `dataform` on your `PATH`. If none is found, the sidebar and canvas tell you how to install it.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `dataformDag.cliPath` | `""` | Path to the Dataform CLI. Empty means auto-detect (see above). |

---

Source and contribution guide: [github.com/cadamsmith/dataform-dag](https://github.com/cadamsmith/dataform-dag)
