import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SerializedGraph } from "@dataform-dag/core";
import type { DagGraphProps } from "../src/DagGraph.js";

// Stub the React Flow canvas: jsdom can't lay it out, and these tests are about App wiring
// (capability gating, selection → detail panel), not the canvas. The stub exposes a select button
// per node so we can drive selection deterministically.
vi.mock("../src/DagGraph.js", () => ({
  DagGraph: ({ graph, onSelectNode, onFocusNode, contextIds }: DagGraphProps) => (
    <div data-testid="canvas">
      {graph.nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-context={contextIds?.includes(n.id) ? "true" : undefined}
          onClick={() => onSelectNode(n.id)}
        >
          {`select:${n.id}`}
        </button>
      ))}
      {/* Stands in for double-clicking a node. */}
      {graph.nodes.map((n) => (
        <button key={`f-${n.id}`} type="button" onClick={() => onFocusNode?.(n.id)}>
          {`focus:${n.id}`}
        </button>
      ))}
      <button type="button" onClick={() => onSelectNode(null)}>
        pane
      </button>
    </div>
  ),
}));

import { App, LARGE_GRAPH } from "../src/App.js";
import { MockBridge } from "../src/MockBridge.js";

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "def/src.sqlx", type: "source", tags: [], refs: [] },
    { id: "mid", filePath: "def/mid.sqlx", type: "table", tags: ["core"], refs: ["src"], description: "a middle node" },
  ],
  downstream: [["src", ["mid"]]],
  issues: [],
};

describe("App", () => {
  it("requests the graph on mount and renders the node count", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    expect(bridge.sent[0]).toEqual({ type: "ready" });
    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
  });

  it("shows Refresh only when the host does not live-watch, and sends requestRefresh", async () => {
    const bridge = new MockBridge(graph, { liveWatch: false });
    render(<App bridge={bridge} />);
    const refresh = await screen.findByRole("button", { name: "Refresh" });
    await userEvent.click(refresh);
    expect(bridge.sent).toContainEqual({ type: "requestRefresh" });
  });

  it("hides Refresh when the host live-watches", async () => {
    render(<App bridge={new MockBridge(graph, { liveWatch: true })} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("opens a detail panel on select with upstream/downstream, and gates Go to file on capability", async () => {
    const bridge = new MockBridge(graph, { openFile: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "mid" })).toBeInTheDocument();
    expect(within(panel).getByText("a middle node")).toBeInTheDocument();
    // upstream "src" appears as a clickable neighbor
    expect(within(panel).getByRole("button", { name: "src" })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Go to file" }));
    expect(bridge.sent).toContainEqual({ type: "openFile", nodeId: "mid", filePath: "def/mid.sqlx" });
  });

  it("clears the detail panel when the canvas background is clicked", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pane" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("hides Go to file when the host cannot open files", async () => {
    render(<App bridge={new MockBridge(graph, { openFile: false })} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    expect(screen.queryByRole("button", { name: "Go to file" })).not.toBeInTheDocument();
  });
});

describe("node search", () => {
  it("jumps to a matching node and opens its detail panel", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await screen.findByText("2 nodes");
    await userEvent.type(screen.getByRole("combobox", { name: "Find a node" }), "mi");
    await userEvent.click(screen.getByRole("option", { name: /mid/ }));
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "mid" }))
      .toBeInTheDocument();
  });

  it("reports no match rather than an empty menu", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await screen.findByText("2 nodes");
    await userEvent.type(screen.getByRole("combobox", { name: "Find a node" }), "zzz");
    expect(screen.getByText(/No node matches/)).toBeInTheDocument();
  });
});

describe("tag filter", () => {
  it("narrows the graph and reports the filtered count against the total", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /core/ }));
    expect(await screen.findByText("1 of 2 nodes")).toBeInTheDocument();
    expect(bridge.sent).toContainEqual({ type: "setTagFilter", selectedTags: ["core"] });
  });

  it("closes the picker on an outside click or Escape without changing the filter", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByRole("dialog", { name: "Filter by tag" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog", { name: "Filter by tag" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filter by tag" })).not.toBeInTheDocument();
    expect(bridge.sent.some((m) => m.type === "setTagFilter")).toBe(false);
  });

  it("lists the active tags under the topbar, each removable", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["core"] }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove tag core" }));
    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
    expect(bridge.sent).toContainEqual({ type: "setTagFilter", selectedTags: [] });
  });

  it("shows a match's neighbors as context when asked, and only while a tag is selected", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByRole("button", { name: /Show neighbors/ })).toBeNull();

    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["core"] }));
    await screen.findByText("1 of 2 nodes");
    await userEvent.click(screen.getByRole("button", { name: /Show neighbors/ }));

    // src isn't tagged core but feeds mid, so it comes back, marked as context.
    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show neighbors/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "select:src" })).toHaveAttribute("data-context", "true");
    expect(screen.getByRole("button", { name: "select:mid" })).not.toHaveAttribute("data-context");
  });

  it("restores a filter the host persisted", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["core"] }));
    expect(await screen.findByText("1 of 2 nodes")).toBeInTheDocument();
  });
});

describe("diagnostics", () => {
  const withIssues: SerializedGraph = {
    ...graph,
    issues: [
      { kind: "duplicate-node-id", nodeId: "mid", filePaths: ["def/mid.sqlx", "def/mid_copy.sqlx"] },
    ],
  };

  it("stays hidden when the graph is clean", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByText(/issue/)).not.toBeInTheDocument();
  });

  it("lists a duplicate id with each of its files", async () => {
    render(<App bridge={new MockBridge(withIssues)} />);
    await userEvent.click(await screen.findByText("1 issue"));
    expect(screen.getByText("def/mid_copy.sqlx")).toBeInTheDocument();
  });
});

describe("compilation", () => {
  it("surfaces compilation status", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "compilationStatus", status: "compiling" }));
    expect(await screen.findByText("Compiling…")).toBeInTheDocument();
  });

  it("keeps the last good graph on screen when a recompile fails", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() =>
      bridge.emit({ type: "compilationStatus", status: "error", message: "syntax error in mid" }),
    );
    const pill = await screen.findByText(/Compile failed — showing last good graph/);
    expect(pill).toHaveAttribute("title", "syntax error in mid");
    expect(screen.getByText("2 nodes")).toBeInTheDocument();
  });

  it("shows the compile error when there is no graph yet", async () => {
    const bridge = new MockBridge(null);
    render(<App bridge={bridge} />);
    expect(screen.getByText("Compiling the project…")).toBeInTheDocument();
    act(() =>
      bridge.emit({ type: "compilationStatus", status: "error", message: "syntax error in mid" }),
    );
    expect(await screen.findByText("The project failed to compile.")).toBeInTheDocument();
    expect(screen.getByText("syntax error in mid")).toBeInTheDocument();
  });

  it("explains how to install the CLI when it is missing", async () => {
    const bridge = new MockBridge(null);
    render(<App bridge={bridge} />);
    act(() => bridge.emit({ type: "compilationStatus", status: "cli-missing" }));
    expect(await screen.findByText("Dataform CLI not found.")).toBeInTheDocument();
    expect(screen.getByText(/dataformDag\.cliPath/)).toBeInTheDocument();
  });

  it("requests compiled SQL and renders the returned sections in order", async () => {
    const bridge = new MockBridge(graph, { compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    await userEvent.click(screen.getByRole("button", { name: "Compiled SQL" }));
    expect(bridge.sent).toContainEqual({
      type: "showCompiledSql",
      nodeId: "mid",
      filePath: "def/mid.sqlx",
    });
    act(() => bridge.emit({
      type: "compiledSqlResult",
      nodeId: "mid",
      sections: [
      { label: "pre_operations", sql: "DECLARE x INT64" },
      { label: "query", sql: "SELECT 1" },
      ],
      }));
    const labels = (await screen.findAllByRole("heading", { level: 3 })).map((h) => h.textContent);
    expect(labels).toContain("pre_operations");
    expect(labels.indexOf("pre_operations")).toBeLessThan(labels.indexOf("query"));
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
  });

  it("copies one section's SQL from the button in its corner", async () => {
    const user = userEvent.setup(); // installs a clipboard stub we can read back
    const bridge = new MockBridge(graph, { compiledSql: true });
    render(<App bridge={bridge} />);
    await user.click(await screen.findByRole("button", { name: "select:mid" }));
    await user.click(screen.getByRole("button", { name: "Compiled SQL" }));
    act(() =>
      bridge.emit({
        type: "compiledSqlResult",
        nodeId: "mid",
        sections: [
          { label: "pre_operations", sql: "DECLARE x INT64" },
          { label: "query", sql: "SELECT 1" },
        ],
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Copy query" }));

    expect(await navigator.clipboard.readText()).toBe("SELECT 1");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    // The other section's button is untouched.
    expect(screen.getByRole("button", { name: "Copy pre_operations" })).toBeInTheDocument();
  });

  it("does not render SQL fetched for a different node", async () => {
    const bridge = new MockBridge(graph, { compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    act(() => bridge.emit({
      type: "compiledSqlResult",
      nodeId: "src",
      sections: [{ label: "query", sql: "SELECT 'wrong node'" }],
      }));
    await waitFor(() => expect(screen.queryByText("SELECT 'wrong node'")).not.toBeInTheDocument());
  });

  it("shows a compile error for the selected node", async () => {
    const bridge = new MockBridge(graph, { compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    act(() => bridge.emit({ type: "compiledSqlError", nodeId: "mid", message: "dataform CLI not found" }));
    expect(await screen.findByText("dataform CLI not found")).toBeInTheDocument();
  });

  it("clears stale SQL when a new compile starts", async () => {
    const bridge = new MockBridge(graph, { compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    act(() => bridge.emit({
      type: "compiledSqlResult",
      nodeId: "mid",
      sections: [{ label: "query", sql: "SELECT 1" }],
      }));
    expect(await screen.findByText("SELECT 1")).toBeInTheDocument();
    act(() => bridge.emit({ type: "compilationStatus", status: "compiling" }));
    await waitFor(() => expect(screen.queryByText("SELECT 1")).not.toBeInTheDocument());
  });
});

describe("assertion grouping", () => {
  /** Two assertions hanging off the same model — the shape a compiled Dataform graph explodes into. */
  const withAssertions: SerializedGraph = {
    nodes: [
      { id: "src", filePath: "def/src.sqlx", type: "source", tags: [], refs: [] },
      { id: "fct", filePath: "def/fct.sqlx", type: "table", tags: [], refs: ["src"] },
      {
        id: "assert_rows",
        filePath: "def/assert_rows.sqlx",
        type: "assertion",
        tags: ["dq"],
        refs: ["fct"],
      },
      {
        id: "assert_unique",
        filePath: "def/assert_unique.sqlx",
        type: "assertion",
        tags: [],
        refs: ["fct"],
      },
    ],
    downstream: [
      ["src", ["fct"]],
      ["fct", ["assert_rows", "assert_unique"]],
    ],
    issues: [],
  };
  const CLUSTER = "assertions:fct";

  it("draws one node for assertions in the same position and counts it against the total", async () => {
    render(<App bridge={new MockBridge(withAssertions)} />);
    expect(await screen.findByRole("button", { name: `select:${CLUSTER}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "select:assert_rows" })).not.toBeInTheDocument();
    expect(screen.getByText("3 of 4 nodes")).toBeInTheDocument();
  });

  it("lists the members, with per-member file actions", async () => {
    const bridge = new MockBridge(withAssertions, { openFile: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: `select:${CLUSTER}` }));

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "2 assertions" })).toBeInTheDocument();
    expect(within(panel).getByText("assert_rows")).toBeInTheDocument();
    expect(within(panel).getByText("assert_unique")).toBeInTheDocument();
    // The cluster's upstream is its members' shared parent.
    expect(within(panel).getByRole("button", { name: "fct" })).toBeInTheDocument();

    await userEvent.click(within(panel).getAllByRole("button", { name: "Go to file" })[0]!);
    expect(bridge.sent).toContainEqual({
      type: "openFile",
      nodeId: "assert_rows",
      filePath: "def/assert_rows.sqlx",
    });
  });

  it("finds a collapsed assertion by name and calls it out inside the cluster", async () => {
    render(<App bridge={new MockBridge(withAssertions)} />);
    await screen.findByText("3 of 4 nodes");
    await userEvent.type(screen.getByRole("combobox", { name: "Find a node" }), "unique");
    await userEvent.click(screen.getByRole("option", { name: /assert_unique/ }));

    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "2 assertions" })).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { current: true })).toHaveTextContent(
      "assert_unique",
    );
  });

  it("opens the cluster when the host focuses a collapsed assertion", async () => {
    const bridge = new MockBridge(withAssertions);
    render(<App bridge={bridge} />);
    await screen.findByText("3 of 4 nodes");

    act(() => bridge.emit({ type: "focusNode", nodeId: "assert_rows" }));

    const panel = await screen.findByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "2 assertions" })).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { current: true })).toHaveTextContent("assert_rows");
  });

  it("renders compiled SQL under the member that asked for it", async () => {
    const bridge = new MockBridge(withAssertions, { compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: `select:${CLUSTER}` }));
    await userEvent.click(screen.getAllByRole("button", { name: "Compiled SQL" })[0]!);
    expect(bridge.sent).toContainEqual({
      type: "showCompiledSql",
      nodeId: "assert_rows",
      filePath: "def/assert_rows.sqlx",
    });

    act(() =>
      bridge.emit({
        type: "compiledSqlResult",
        nodeId: "assert_rows",
        sections: [{ label: "query", sql: "SELECT 'assert_rows'" }],
      }),
    );

    // Scope to that member's row: SQL for one assertion must not render under its sibling.
    const rowsItem = screen.getByText("assert_rows").closest("li")!;
    expect(within(rowsItem).getByText("SELECT 'assert_rows'")).toBeInTheDocument();
    const uniqueItem = screen.getByText("assert_unique").closest("li")!;
    expect(within(uniqueItem).queryByText("SELECT 'assert_rows'")).not.toBeInTheDocument();
  });

});

describe("focus mode", () => {
  //   src ─▶ stg ─▶ fct ─▶ agg
  //                  └─▶ assert_rows, assert_unique (one cluster)
  //   lone (unrelated)
  const chain: SerializedGraph = {
    nodes: [
      { id: "src", filePath: "def/src.sqlx", type: "source", tags: ["raw"], refs: [] },
      { id: "stg", filePath: "def/stg.sqlx", type: "view", tags: [], refs: ["src"] },
      { id: "fct", filePath: "def/fct.sqlx", type: "table", tags: ["core"], refs: ["stg"] },
      { id: "agg", filePath: "def/agg.sqlx", type: "table", tags: [], refs: ["fct"] },
      { id: "assert_rows", filePath: "def/ar.sqlx", type: "assertion", tags: [], refs: ["fct"] },
      { id: "assert_unique", filePath: "def/au.sqlx", type: "assertion", tags: [], refs: ["fct"] },
      { id: "lone", filePath: "def/lone.sqlx", type: "table", tags: [], refs: [] },
    ],
    downstream: [
      ["src", ["stg"]],
      ["stg", ["fct"]],
      ["fct", ["agg", "assert_rows", "assert_unique"]],
    ],
    issues: [],
  };
  const focusBar = () => screen.queryByRole("region", { name: "Focus mode" });

  it("shows only the node's lineage from the panel's Focus button, and exits back", async () => {
    render(<App bridge={new MockBridge(chain)} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:stg" }));
    await userEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Focus" }));

    // stg, src, fct, agg and the 2-assertion cluster: lone is gone.
    expect(await screen.findByText("5 of 7 nodes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "select:lone" })).not.toBeInTheDocument();
    expect(within(focusBar()!).getByText("stg")).toBeInTheDocument();
    expect(within(focusBar()!).getByText("1 upstream, 4 downstream")).toBeInTheDocument();
    // Already the focus: no second Focus button.
    expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Focus" })).toBeNull();

    await userEvent.click(within(focusBar()!).getByRole("button", { name: "Exit focus" }));
    expect(await screen.findByText("6 of 7 nodes")).toBeInTheDocument();
    expect(focusBar()).toBeNull();
  });

  it("enters on double-click and leaves on Escape", async () => {
    render(<App bridge={new MockBridge(chain)} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:agg" }));
    expect(await screen.findByText("4 of 7 nodes")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(focusBar()).toBeNull();
  });

  it("narrows to fewer hops with the depth stepper", async () => {
    render(<App bridge={new MockBridge(chain)} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:agg" }));
    await screen.findByText("4 of 7 nodes");
    const bar = focusBar()!;
    expect(within(bar).getByRole("button", { name: "More hops" })).toBeDisabled();

    await userEvent.click(within(bar).getByRole("button", { name: "Fewer hops" }));
    expect(within(bar).getByText("2 hops")).toBeInTheDocument();
    expect(await screen.findByText("3 of 7 nodes")).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole("button", { name: "More hops" }));
    expect(within(bar).getByText("All")).toBeInTheDocument();
    expect(await screen.findByText("4 of 7 nodes")).toBeInTheDocument();
  });

  it("focuses an assertion cluster as a whole", async () => {
    render(<App bridge={new MockBridge(chain)} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:assertions:fct" }));
    // Both assertions (still one cluster) plus fct, stg, src.
    expect(await screen.findByText("4 of 7 nodes")).toBeInTheDocument();
    expect(within(focusBar()!).getByText("2 assertions")).toBeInTheDocument();
  });

  it("enters focus mode when the host asks", async () => {
    const bridge = new MockBridge(chain);
    render(<App bridge={bridge} />);
    await screen.findByText("6 of 7 nodes");
    act(() => bridge.emit({ type: "focusLineage", nodeId: "fct" }));
    expect(await screen.findByText("5 of 7 nodes")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "fct" })).toBeInTheDocument();
  });

  it("leaves focus mode when a tag filter hides the focused node", async () => {
    const bridge = new MockBridge(chain);
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:fct" }));
    await screen.findByText("5 of 7 nodes");
    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["raw"] }));
    expect(await screen.findByText("1 of 7 nodes")).toBeInTheDocument();
    expect(focusBar()).toBeNull();
  });

  it("an Escape that closes the tag menu stays in focus mode", async () => {
    render(<App bridge={new MockBridge(chain)} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:fct" }));
    await screen.findByText("5 of 7 nodes");
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    // Move off the tag search field, so the Escape isn't ignored for coming from an input.
    await userEvent.click(screen.getByRole("dialog", { name: "Filter by tag" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Filter by tag" })).toBeNull();
    expect(focusBar()).not.toBeNull();
  });
});

/** `src ─▶ core ─▶ m0…mN`: just over the start-screen threshold. */
const wide: SerializedGraph = (() => {
  const leaves = Array.from({ length: LARGE_GRAPH }, (_, i) => `m${i}`);
  return {
    nodes: [
      { id: "src", filePath: "src.sqlx", type: "source", tags: [], refs: [] },
      { id: "core", filePath: "core.sqlx", type: "table", tags: [], refs: ["src"] },
      ...leaves.map((id) => ({
        id,
        filePath: `${id}.sqlx`,
        type: "table" as const,
        tags: id === "m1" ? ["one"] : [],
        refs: ["core"],
      })),
    ],
    downstream: [
      ["src", ["core"]],
      ["core", leaves],
    ],
    issues: [],
  };
})();
const wideCount = `${(LARGE_GRAPH + 2).toLocaleString()} nodes`;

describe("App on a large project", () => {
  const focusBar = () => screen.queryByRole("region", { name: "Focus mode" });

  it("opens on the start screen and draws nothing", async () => {
    render(<App bridge={new MockBridge(wide)} />);
    expect(await screen.findByText(/pick a place to start/)).toBeInTheDocument();
    expect(screen.getByText(wideCount)).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });

  it("starts from the lineage of the node the host starts from", async () => {
    const bridge = new MockBridge(wide);
    render(<App bridge={bridge} />);
    await screen.findByText(/pick a place to start/);
    act(() => bridge.emit({ type: "startFrom", nodeId: "m5" }));
    expect(await screen.findByText(`3 of ${wideCount}`)).toBeInTheDocument();
    expect(focusBar()).not.toBeNull();
  });

  it("starts from a node the host focuses while the start screen is up (an editor switch)", async () => {
    const bridge = new MockBridge(wide);
    render(<App bridge={bridge} />);
    await screen.findByText(/pick a place to start/);
    act(() => bridge.emit({ type: "focusNode", nodeId: "m5" }));
    expect(await screen.findByText(`3 of ${wideCount}`)).toBeInTheDocument();
  });

  it("ignores startFrom on a small project", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "startFrom", nodeId: "mid" }));
    expect(screen.getByText("2 nodes")).toBeInTheDocument();
    expect(focusBar()).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("starts from a searched node, and goes back to the start screen on leaving focus", async () => {
    render(<App bridge={new MockBridge(wide)} />);
    await screen.findByText(/pick a place to start/);
    await userEvent.type(screen.getByRole("combobox", { name: "Find a node" }), "m7{Enter}");
    expect(await screen.findByText(`3 of ${wideCount}`)).toBeInTheDocument();
    await userEvent.click(within(focusBar()!).getByRole("button", { name: "Exit focus" }));
    expect(await screen.findByText(/pick a place to start/)).toBeInTheDocument();
    // The node stays selected, but its panel would describe something that isn't drawn.
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("limits a focus whose whole lineage is a large project's worth of nodes", async () => {
    const bridge = new MockBridge(wide);
    render(<App bridge={bridge} />);
    await screen.findByText(/pick a place to start/);
    act(() => bridge.emit({ type: "focusLineage", nodeId: "src" }));
    // One hop: just core. Unbounded would have been every node.
    expect(await screen.findByText(`2 of ${wideCount}`)).toBeInTheDocument();
  });

  it("draws a tag filter's matches without asking first", async () => {
    const bridge = new MockBridge(wide);
    render(<App bridge={bridge} />);
    await screen.findByText(/pick a place to start/);
    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["one"] }));
    expect(await screen.findByText(`1 of ${wideCount}`)).toBeInTheDocument();
  });

  it("draws everything on Show all", async () => {
    render(<App bridge={new MockBridge(wide)} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Show all/ }));
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText(wideCount)).toBeInTheDocument();
  });
});

/** Over the threshold, in folders: `core/hub` feeds `agencies/<n>/model_<n>`, plus a root file. */
const foldered: SerializedGraph = (() => {
  const agencies = Array.from({ length: LARGE_GRAPH }, (_, i) => i);
  return {
    nodes: [
      { id: "hub", filePath: "defs/core/hub.sqlx", type: "table", tags: [], refs: [] },
      { id: "top", filePath: "defs/top.sqlx", type: "view", tags: [], refs: ["hub"] },
      ...agencies.map((i) => ({
        id: `model_${i}`,
        filePath: `defs/agencies/a${i}/model_${i}.sqlx`,
        type: "table" as const,
        tags: [],
        refs: ["hub"],
      })),
    ],
    downstream: [["hub", ["top", ...agencies.map((i) => `model_${i}`)]]],
    issues: [],
  };
})();
const folderedCount = (LARGE_GRAPH + 2).toLocaleString();

describe("App, grouped by folder", () => {
  it("opens a large project on its top-level folders", async () => {
    render(<App bridge={new MockBridge(foldered)} />);
    // core/, agencies/, and the root file.
    expect(await screen.findByText(`3 of ${folderedCount} nodes`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "focus:folder:agencies" })).toBeInTheDocument();
    expect(screen.queryByText(/pick a place to start/)).toBeNull();
  });

  it("expands a folder on double-click, and collapses it back from the panel", async () => {
    render(<App bridge={new MockBridge(foldered)} />);
    await userEvent.click(await screen.findByRole("button", { name: "focus:folder:agencies" }));
    // One folder per agency now, instead of agencies/.
    await userEvent.click(await screen.findByRole("button", { name: "select:folder:agencies/a3" }));
    expect(screen.queryByRole("button", { name: "select:folder:agencies" })).toBeNull();
    const panel = screen.getByRole("complementary");
    await userEvent.click(within(panel).getByRole("button", { name: "Collapse agencies/" }));
    expect(await screen.findByText(`3 of ${folderedCount} nodes`)).toBeInTheDocument();
  });

  it("opens the folders above a searched node", async () => {
    render(<App bridge={new MockBridge(foldered)} />);
    await screen.findByText(`3 of ${folderedCount} nodes`);
    await userEvent.type(screen.getByRole("combobox", { name: "Find a node" }), "model_7{Enter}");
    expect(await screen.findByRole("button", { name: "select:model_7" })).toBeInTheDocument();
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "model_7" })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Collapse folder" }));
    expect(screen.queryByRole("button", { name: "select:model_7" })).toBeNull();
  });

  it("still starts from the opened file's lineage, ungrouped", async () => {
    const bridge = new MockBridge(foldered);
    render(<App bridge={bridge} />);
    await screen.findByText(`3 of ${folderedCount} nodes`);
    act(() => bridge.emit({ type: "startFrom", nodeId: "model_4" }));
    expect(await screen.findByRole("button", { name: "select:model_4" })).toBeInTheDocument();
    expect(screen.getByText(`2 of ${folderedCount} nodes`)).toBeInTheDocument();
  });

  it("never sends a folder id to the host", async () => {
    const bridge = new MockBridge(foldered, { openFile: true, compiledSql: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:folder:core" }));
    expect(within(screen.getByRole("complementary")).queryByRole("button", { name: "Go to file" })).toBeNull();
    expect(bridge.sent.filter((m) => "nodeId" in m && String(m.nodeId).startsWith("folder:"))).toEqual([]);
  });

  it("shows every node when grouping is turned off", async () => {
    render(<App bridge={new MockBridge(foldered)} />);
    await userEvent.click(await screen.findByRole("button", { name: "Group by folder" }));
    expect(await screen.findByText(`${folderedCount} nodes`)).toBeInTheDocument();
  });
});
