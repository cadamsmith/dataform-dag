# 🔀 dataform-dag

Explore your [Dataform](https://cloud.google.com/dataform) project's dependency graph as an interactive diagram,
right inside VS Code. The graph is parsed straight from your `.sqlx` files — **no warehouse
connection, no cloud, and no compile step required.** When you do want compiler-exact output, one
click switches the canvas over to `dataform compile`.

<img alt="image" src="https://github.com/user-attachments/assets/3d1dfb01-788e-4384-9f75-b36057dc909a" />

## Features

- **See the whole graph at a glance.** Every model, source, view, and assertion in your project,
  laid out left-to-right by dependency with a color-coded legend and a minimap for large projects.
- **Stay readable at scale.** Assertions that hang off the same models collapse into a single
  "N assertions" node — click it to list them, with each one's file and compiled SQL still one click
  away. Toggle grouping off from the toolbar when you want them all on the canvas.
- **Find anything fast.** Search nodes by name, or filter the canvas down to one or more Dataform
  `tags` — the node count in the top bar tracks what's visible.
- **Inspect a node.** Click one for its type, tags, file path, and upstream/downstream refs — and
  the SQL Dataform actually compiles it to.
- **Browse from the sidebar.** The Dataform DAG icon in the activity bar lists every action in the
  project grouped by type — sources, tables, views, incrementals, assertions, operations — with each
  one's tags beside it. Click a row to open its file; the canvas follows along when it's open.
- **Jump straight to the code.** Click through to open a node's `.sqlx` file in the editor.
- **Follow along as you navigate.** Switch the active editor to a modeled file and its node is
  highlighted on the canvas.
- **Live updates.** Edit and save any `.sqlx` and the graph rebuilds automatically — no refresh.
- **Catch broken refs.** Unresolved `ref()`s and duplicate node names show up as issues in the top
  bar, each one clickable straight to the node.
- **Two levels of fidelity.** Stay on the fast built-in parser, or flip the **parsed / compiled**
  toggle to build the graph from `dataform compile` and pick up inline assertions and refs
  constructed in JS. If compiling fails, it says so and drops back to the parsed graph.

## Getting started

1. Open a Dataform project folder in VS Code (one with a `definitions/**/*.sqlx` tree).
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
- A Dataform project with a `definitions/` folder of `.sqlx` files.
- Nothing else for the default view. Compiled mode and **Show Compiled SQL** shell out to the
  [Dataform CLI](https://cloud.google.com/dataform/docs/use-dataform-cli), so those two need it
  installed and a project that compiles.

## Notes

By default the graph is built by parsing `.sqlx` text directly, which is what keeps it fast and
dependency-free. Two things follow from that: assertions declared inline in a model's `config` block
are folded into that model rather than shown as separate nodes, and a `ref()` inside a commented-out
line of SQL is still counted as a dependency. For most projects the parsed graph matches the compiled
one node-for-node — and where it matters, the **compiled** toggle gives you the compiler's answer.

---

Source and contribution guide: [github.com/cadamsmith/dataform-dag](https://github.com/cadamsmith/dataform-dag)
