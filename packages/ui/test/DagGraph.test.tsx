import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { SerializedGraph } from "@dataform-dag/core";
import { layoutGraph } from "../src/graphToFlow.js";
import {
  DagGraph,
  anchorBetween,
  emphasisFor,
  emphasizeEdges,
  emphasizeNodes,
  type ModelNodeData,
} from "../src/DagGraph.js";
import type { Edge, Node } from "@xyflow/react";

// React Flow measures its pane via getBoundingClientRect; jsdom returns zeros, so give it a size.
const originalRect = Element.prototype.getBoundingClientRect;
function sizePane(): void {
  Element.prototype.getBoundingClientRect = vi.fn(
    () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} }) as DOMRect,
  );
}
afterEach(() => {
  cleanup(); // unmount before restoring, so React Flow's async measure work stops first
  Element.prototype.getBoundingClientRect = originalRect;
});

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "src.sqlx", type: "source", tags: [], refs: [] },
    { id: "mid", filePath: "mid.sqlx", type: "table", tags: [], refs: ["src"] },
  ],
  downstream: [["src", ["mid"]]],
  issues: [],
};

describe("DagGraph (real React Flow canvas)", () => {
  it("renders a node element per graph node and fires onSelectNode when one is clicked", async () => {
    sizePane();
    const onSelectNode = vi.fn();
    const { container } = render(
      <DagGraph graph={layoutGraph(graph)} selectedId={null} focus={null} onSelectNode={onSelectNode} />,
    );
    // React Flow renders each node as a .react-flow__node element carrying its id.
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBe(2));
    const midNode = container.querySelector('.react-flow__node[data-id="mid"]');
    expect(midNode).not.toBeNull();
    fireEvent.click(midNode as Element);
    expect(onSelectNode).toHaveBeenCalledWith("mid");
  });
});

describe("DagGraph emphasis across relayouts", () => {
  // With nothing selected, no other input to the styling changes when a layout lands, so only the
  // graph itself can tell the canvas to reapply it.
  it("keeps context styling when a new layout lands with the same context set", async () => {
    sizePane();
    const props = { selectedId: null, focus: null, onSelectNode: vi.fn(), contextIds: ["src"] };
    const { container, rerender } = render(<DagGraph graph={layoutGraph(graph)} {...props} />);
    const isContext = () =>
      container.querySelector('[data-id="src"] .ddag-node')?.classList.contains("is-context");
    await waitFor(() => expect(isContext()).toBe(true));

    // A recompile or filter change lands a new layout object; the context set is unchanged.
    rerender(<DagGraph graph={layoutGraph(graph)} {...props} />);

    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(isContext()).toBe(true);
  });
});

describe("anchorBetween", () => {
  const at = (id: string, x: number, y: number) => ({
    id,
    position: { x, y },
    width: 100,
    height: 40,
    data: { label: id, nodeType: "table" as const, color: "" },
  });

  it("holds the selection still when it survives the relayout", () => {
    const anchor = anchorBetween([at("a", 0, 0), at("b", 500, 0)], [at("a", 40, 10), at("b", 0, 0)], "a", {
      x: 550,
      y: 20,
    });
    expect(anchor).toEqual({ before: { x: 0, y: 0 }, after: { x: 40, y: 10 } });
  });

  it("otherwise picks the surviving node nearest the middle of the view", () => {
    const anchor = anchorBetween([at("a", 0, 0), at("b", 500, 0), at("gone", 260, 0)], [at("a", 0, 0), at("b", 300, 0)], null, {
      x: 480,
      y: 20,
    });
    expect(anchor?.after).toEqual({ x: 300, y: 0 });
  });

  it("returns null when nothing survives", () => {
    expect(anchorBetween([at("a", 0, 0)], [at("b", 0, 0)], "a", { x: 0, y: 0 })).toBeNull();
  });
});

describe("emphasis", () => {
  // a ─▶ b ─▶ c, and x ─▶ y off to the side.
  const flowEdges: Edge[] = [
    { id: "a-b", source: "a", target: "b" },
    { id: "b-c", source: "b", target: "c" },
    { id: "x-y", source: "x", target: "y" },
  ];
  const flowNodes: Node<ModelNodeData>[] = ["a", "b", "c", "x", "y"].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    data: { label: id, color: "", nodeType: "table", selected: false, dimmed: false, root: false, context: false },
  }));
  const none = new Set<string>();
  const em = (selected: string | null, hovered: string | null) =>
    emphasisFor(flowEdges, selected, hovered, none, none);
  const dimmed = (nodes: Node<ModelNodeData>[]) => nodes.filter((n) => n.data.dimmed).map((n) => n.id);

  it("hover dims nothing; it only lights the hovered node's edges", () => {
    const nodes = emphasizeNodes(flowNodes, em(null, "b"));
    expect(dimmed(nodes)).toEqual([]);
    const edges = emphasizeEdges(flowEdges, em(null, "b"));
    expect(edges.map((e) => e.className)).toEqual(["is-active", "is-active", undefined]);
  });

  it("selection dims everything but its neighbors, and hover lifts the hovered node's", () => {
    expect(dimmed(emphasizeNodes(flowNodes, em("a", null)))).toEqual(["c", "x", "y"]);
    expect(dimmed(emphasizeNodes(flowNodes, em("a", "x")))).toEqual(["c"]);
  });

  it("keeps the same object for every node and edge a hover doesn't change", () => {
    const nodes = emphasizeNodes(flowNodes, em(null, "b"));
    expect(nodes.every((n, i) => n === flowNodes[i])).toBe(true);
    const edges = emphasizeEdges(flowEdges, em(null, "b"));
    expect(edges[2]).toBe(flowEdges[2]);
    // Moving the pointer off again only touches the edges it had lit.
    const after = emphasizeEdges(edges, em(null, null));
    expect(after[0]).not.toBe(edges[0]);
    expect(after[2]).toBe(edges[2]);
  });
});
