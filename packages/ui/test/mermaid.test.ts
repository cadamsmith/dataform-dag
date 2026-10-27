import { describe, expect, it } from "vitest";
import type { UiGraph, UiNode } from "../src/graphToFlow.js";
import { edgeCount, toMermaid } from "../src/mermaid.js";

const node = (id: string, type: UiNode["type"], refs: string[] = [], extra: Partial<UiNode> = {}): UiNode => ({
  id,
  filePath: `${id}.sqlx`,
  type,
  tags: [],
  refs,
  ...extra,
});

const graph: UiGraph = {
  nodes: [
    node("raw.events", "source"),
    node("end", "table", ["raw.events"]),
    node("v", "view", ["end"]),
    node("assertions:end", "assertion", ["end"], { label: "2 assertions", count: 2 }),
    node("folder:marts", "table", ["v"], { label: 'marts/"x"', folder: true }),
  ],
  downstream: [],
  issues: [],
};

describe("toMermaid", () => {
  it("draws a left-to-right flowchart with generated ids and the real names as labels", () => {
    const out = toMermaid(graph);
    expect(out.startsWith("flowchart LR\n")).toBe(true);
    // A qualified name and a Mermaid keyword are safe as labels, never as ids.
    expect(out).toContain('n0[("raw.events")]:::source');
    expect(out).toContain('n1["end"]:::table');
    expect(out).toContain('n2("v"):::view');
    expect(out).toContain('n3{{"2 assertions"}}:::assertion');
    expect(out).toContain('n4[["marts/#quot;x#quot;"]]:::folder');
    expect(out).toContain("n0 --> n1");
    expect(out).toContain("n2 --> n4");
  });

  it("defines a class only for the kinds present", () => {
    const out = toMermaid(graph);
    expect(out).toContain("classDef table fill:#4c8dff33,stroke:#4c8dff");
    expect(out).toContain("classDef folder");
    expect(out).not.toContain("classDef incremental");
    expect(out).not.toContain("classDef context");
  });

  it("marks context and focus roots", () => {
    const out = toMermaid(graph, { context: new Set(["v"]), roots: new Set(["end"]) });
    expect(out).toContain("class n2 context");
    expect(out).toContain("class n1 root");
  });

  it("nests open folders as subgraphs, merging folders that hold only one subfolder", () => {
    const folders: Record<string, string> = { v: "a/b", end: "a/b/c", "folder:marts": "" };
    const out = toMermaid(graph, { folderOf: (n) => folders[n.id] ?? null });
    expect(out).toContain(
      ['  subgraph f0["a/b/"]', '    n2("v"):::view', '    subgraph f1["a/b/c/"]', '      n1["end"]:::table', "    end", "  end"].join("\n"),
    );
  });

  it("skips refs to nodes that aren't drawn", () => {
    const lone: UiGraph = { nodes: [node("x", "table", ["gone"])], downstream: [], issues: [] };
    expect(toMermaid(lone)).not.toContain("-->");
    expect(edgeCount(lone)).toBe(0);
    expect(edgeCount(graph)).toBe(4);
  });
});
