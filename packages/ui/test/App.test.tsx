import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SerializedGraph } from "@dataform-dag/core";
import type { DagGraphProps } from "../src/DagGraph.js";

// Stub the React Flow canvas: jsdom can't lay it out, and these tests are about App wiring
// (capability gating, selection → detail panel), not the canvas. The stub exposes a select button
// per node so we can drive selection deterministically.
vi.mock("../src/DagGraph.js", () => ({
  DagGraph: ({ graph, onSelectNode }: DagGraphProps) => (
    <div data-testid="canvas">
      {graph.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelectNode(n.id)}>
          {`select:${n.id}`}
        </button>
      ))}
      <button type="button" onClick={() => onSelectNode(null)}>
        pane
      </button>
    </div>
  ),
}));

import { App } from "../src/App.js";
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
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a node" }), "mi");
    await userEvent.click(screen.getByRole("button", { name: "mid" }));
    expect(within(screen.getByRole("complementary")).getByRole("heading", { name: "mid" }))
      .toBeInTheDocument();
  });

  it("reports no match rather than an empty menu", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await screen.findByText("2 nodes");
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a node" }), "zzz");
    expect(screen.getByText("no match")).toBeInTheDocument();
  });
});

describe("tag filter", () => {
  it("narrows the graph and reports the filtered count against the total", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    await userEvent.click(screen.getByText("Tags"));
    await userEvent.click(screen.getByRole("checkbox", { name: "core" }));
    expect(await screen.findByText(/1 \/ 2\s*nodes/)).toBeInTheDocument();
    expect(bridge.sent).toContainEqual({ type: "setTagFilter", selectedTags: ["core"] });
  });

  it("restores a filter the host persisted", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "tagFilterState", selectedTags: ["core"] }));
    expect(await screen.findByText(/1 \/ 2\s*nodes/)).toBeInTheDocument();
  });
});

describe("diagnostics", () => {
  const withIssues: SerializedGraph = {
    ...graph,
    issues: [
      { kind: "unresolved-reference", nodeId: "mid", filePath: "def/mid.sqlx", reference: "gone" },
    ],
  };

  it("stays hidden when the graph is clean", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByText(/issue/)).not.toBeInTheDocument();
  });

  it("lists an unresolved reference and explains the parsed-mode caveat", async () => {
    render(<App bridge={new MockBridge(withIssues)} />);
    await userEvent.click(await screen.findByText("1 issue"));
    expect(screen.getByText("gone")).toBeInTheDocument();
    expect(screen.getByText(/Parsed mode reads files literally/)).toBeInTheDocument();
  });
});

describe("compiled mode", () => {
  it("hides the mode toggle when the host cannot compile", async () => {
    render(<App bridge={new MockBridge(graph, { compiledGraph: false })} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByRole("button", { name: "compiled" })).not.toBeInTheDocument();
  });

  it("asks the host to switch mode", async () => {
    const bridge = new MockBridge(graph, { compiledGraph: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "compiled" }));
    expect(bridge.sent).toContainEqual({ type: "setGraphMode", mode: "compiled" });
  });

  it("surfaces compilation status", async () => {
    const bridge = new MockBridge(graph, { compiledGraph: true });
    render(<App bridge={bridge} />);
    await screen.findByText("2 nodes");
    act(() => bridge.emit({ type: "compilationStatus", status: "compiling" }));
    expect(await screen.findByText("compiling…")).toBeInTheDocument();
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
