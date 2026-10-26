import dagre from "@dagrejs/dagre";
import type { DataformNode, GraphIssue, NodeType, SerializedGraph } from "@dataform-dag/core";

/**
 * A node as the UI lays it out: core's node plus presentation-only fields. Everything a host sends
 * is already a valid UiNode; the extras exist for nodes the UI synthesizes itself, like the
 * assertion clusters from `collapseAssertions`.
 */
export interface UiNode extends DataformNode {
  /** Rendered instead of `id` when present — a cluster's id has to stay unique, not readable. */
  label?: string;
  /** How many real nodes this one stands for; absent for an ordinary node. */
  count?: number;
}

/** A SerializedGraph whose nodes may carry those extras. */
export interface UiGraph {
  nodes: UiNode[];
  downstream: Array<[string, string[]]>;
  issues: GraphIssue[];
}

/**
 * Color per node type — the legend the whole UI shares. Each is a CSS variable (light/dark values in
 * app.css, so they follow the editor theme) with a fallback that reads on either background.
 */
export const NODE_COLORS: Record<NodeType, string> = {
  source: "var(--ddag-type-source, #8a94a6)",
  table: "var(--ddag-type-table, #4c8dff)",
  view: "var(--ddag-type-view, #2fb67c)",
  incremental: "var(--ddag-type-incremental, #f08c3a)",
  assertion: "var(--ddag-type-assertion, #ef5a6f)",
  operations: "var(--ddag-type-operations, #a77bf3)",
};

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; nodeType: NodeType; color: string; count?: number };
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Routed polyline (start → bends → end) when a router (ELK) produced one; else undefined. */
  points?: Point[];
}
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_H = 46;
const CHAR_W = 7.7; // ~monospace advance at 13px
const NODE_PAD = 54; // left accent + horizontal padding

/** What a node shows on the canvas: its own label when it has one, else its id. */
export function labelOf(node: UiNode): string {
  return node.label ?? node.id;
}

/** Estimate a node's rendered width from its label so dagre spacing matches, and nothing truncates. */
export function nodeWidth(label: string): number {
  return Math.max(150, Math.round(label.length * CHAR_W) + NODE_PAD);
}

/**
 * Lay a {@link SerializedGraph} out left-to-right with dagre and emit React Flow nodes/edges. Pure
 * and DOM-free. An edge is drawn for every `ref` whose target node exists in the graph; a ref to an
 * absent node (external/unresolved) is dropped rather than pointing at a phantom.
 */
export function layoutGraph(graph: UiGraph): FlowGraph {
  const present = new Set(graph.nodes.map((n) => n.id));
  const g = new dagre.graphlib.Graph();
  // LR layered layout. Generous rank/node separation keeps the many cross-edges of a wide fact
  // graph legible; tight-tree ranking pulls ranks together for fewer long edges.
  g.setGraph({
    rankdir: "LR",
    ranker: "tight-tree",
    nodesep: 40,
    ranksep: 130,
    edgesep: 20,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes)
    g.setNode(node.id, { width: nodeWidth(labelOf(node)), height: NODE_H });
  const edges: FlowEdge[] = [];
  for (const node of graph.nodes) {
    for (const upstream of node.refs) {
      if (!present.has(upstream)) continue;
      g.setEdge(upstream, node.id);
      edges.push({ id: `${upstream}->${node.id}`, source: upstream, target: node.id });
    }
  }
  dagre.layout(g);
  const nodes: FlowNode[] = graph.nodes.map((node) => {
    const laid = g.node(node.id);
    const width = nodeWidth(labelOf(node));
    return {
      id: node.id,
      // dagre centers nodes; React Flow positions by top-left corner.
      position: { x: laid.x - width / 2, y: laid.y - NODE_H / 2 },
      data: {
        label: labelOf(node),
        nodeType: node.type,
        color: NODE_COLORS[node.type],
        count: node.count,
      },
      width,
      height: NODE_H,
    };
  });
  return { nodes, edges };
}

/** Direct-neighbor lookups for the detail panel, built once from the wire form. */
export interface GraphIndex {
  byId: Map<string, DataformNode>;
  downstream: Map<string, string[]>;
}

export function indexGraph(graph: SerializedGraph): GraphIndex {
  return {
    byId: new Map(graph.nodes.map((n) => [n.id, n])),
    downstream: new Map(graph.downstream),
  };
}

/** Direct upstream deps of a node that actually resolve to a node in the graph. */
export function upstreamOf(index: GraphIndex, nodeId: string): string[] {
  const node = index.byId.get(nodeId);
  if (!node) return [];
  return node.refs.filter((r) => index.byId.has(r));
}

/** Direct downstream dependents of a node. */
export function downstreamOf(index: GraphIndex, nodeId: string): string[] {
  return index.downstream.get(nodeId) ?? [];
}
