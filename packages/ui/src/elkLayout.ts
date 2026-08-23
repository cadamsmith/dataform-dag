import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import {
  NODE_COLORS,
  NODE_H,
  labelOf,
  nodeWidth,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type Point,
  type UiGraph,
} from "./graphToFlow.js";

type ElkEngine = { layout(graph: ElkNode): Promise<ElkNode> };

// elkjs is a large (~1.4 MB) GWT-compiled bundle, so load it on demand: this dynamic import becomes
// its own lazy chunk, keeping it out of the initial bundle. Memoized so the engine is built once.
let enginePromise: Promise<ElkEngine> | null = null;
function getEngine(): Promise<ElkEngine> {
  if (!enginePromise) {
    enginePromise = import("elkjs/lib/elk.bundled.js").then((m) => new m.default() as ElkEngine);
  }
  return enginePromise;
}

// Spacing is deliberately generous so parallel edges into a hub node stay in distinct, readable lanes.
const SPACING: Record<string, string> = {
  "elk.layered.spacing.nodeNodeBetweenLayers": "150",
  "elk.spacing.nodeNode": "46",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.spacing.edgeNode": "26",
  "elk.spacing.edgeEdge": "28",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
};

// Fresh layout: ELK assigns layers/order/coords from scratch. ORTHOGONAL routing + crossing
// minimization + Brandes-Köpf placement give the clean lineage-tool look.
const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  ...SPACING,
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
};

/** The ELK edges for a graph, dropping refs whose target node is absent. */
function elkEdgesOf(edges: { id: string; source: string; target: string }[]): ElkExtendedEdge[] {
  return edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
}

/** Pull the routed polyline (start → bends → end) out of a laid-out ELK edge. */
function pointsOf(edge: ElkExtendedEdge): Point[] | undefined {
  const section = edge.sections?.[0];
  return section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : undefined;
}

/**
 * Lay a {@link SerializedGraph} out with ELK and emit the same {@link FlowGraph} the dagre path does,
 * plus routed `points` per edge. Async (ELK runs its layout engine). Refs to absent nodes are
 * dropped, exactly as in the dagre layout, so the two are interchangeable outputs.
 */
export async function layoutGraphElk(graph: UiGraph): Promise<FlowGraph> {
  const present = new Set(graph.nodes.map((n) => n.id));
  const edgeSpecs = [];
  for (const node of graph.nodes) {
    for (const upstream of node.refs) {
      if (present.has(upstream)) edgeSpecs.push({ id: `${upstream}->${node.id}`, source: upstream, target: node.id });
    }
  }
  const root: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: graph.nodes.map((n) => ({
      id: n.id,
      width: nodeWidth(labelOf(n)),
      height: NODE_H,
    })),
    edges: elkEdgesOf(edgeSpecs),
  };
  const engine = await getEngine();
  const laid = await engine.layout(root);
  const byId = new Map((laid.children ?? []).map((c) => [c.id, c]));
  const nodes: FlowNode[] = graph.nodes.map((n) => {
    const c = byId.get(n.id);
    return {
      id: n.id,
      position: { x: c?.x ?? 0, y: c?.y ?? 0 }, // ELK origins at top-left, like React Flow
      data: { label: labelOf(n), nodeType: n.type, color: NODE_COLORS[n.type], count: n.count },
      width: nodeWidth(labelOf(n)),
      height: NODE_H,
    };
  });
  const edges: FlowEdge[] = (laid.edges ?? []).map((e) => {
    const [source] = e.sources ?? [];
    const [target] = e.targets ?? [];
    return { id: e.id, source: source ?? "", target: target ?? "", points: pointsOf(e) };
  });
  return { nodes, edges };
}
