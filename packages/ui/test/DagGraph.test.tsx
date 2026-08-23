import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { SerializedGraph } from "@dataform-dag/core";
import { layoutGraph } from "../src/graphToFlow.js";
import { DagGraph } from "../src/DagGraph.js";

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
