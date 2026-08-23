import { memo, useEffect, useMemo, useState } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeType } from "@dataform-dag/core";
import type { FlowGraph, Point } from "./graphToFlow.js";

export interface DagGraphProps {
  graph: FlowGraph;
  selectedId: string | null;
  /** Bumped by the host asking to focus a node; pans/zooms to it. */
  focus: { nodeId: string; nonce: number } | null;
  /** A node id to select, or null to clear the selection (e.g. clicking empty canvas). */
  onSelectNode: (nodeId: string | null) => void;
}

type ModelNodeData = {
  label: string;
  color: string;
  nodeType: NodeType;
  selected: boolean;
  dimmed: boolean;
  /** Set when this node stands for several collapsed ones — see `collapseAssertions`. */
  count?: number;
};
type ModelNode = Node<ModelNodeData, "model">;

/** A model as a card: type-colored left accent, monospace name, type label. Sized by its label. */
const ModelNode = memo(function ModelNode({ data }: NodeProps<ModelNode>) {
  const cls = `ddag-node${data.selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}${
    data.count ? " is-cluster" : ""
  }`;
  return (
    <div className={cls} style={{ ["--accent" as string]: data.color }}>
      <Handle type="target" position={Position.Left} className="ddag-node__handle" />
      <span className="ddag-node__label">{data.label}</span>
      {/* A cluster's own label already names the type, so the sub-label says what it IS instead. */}
      <span className="ddag-node__type">{data.count ? "grouped — click to list" : data.nodeType}</span>
      <Handle type="source" position={Position.Right} className="ddag-node__handle" />
    </div>
  );
});

const nodeTypes = { model: ModelNode };

/** Rounded-corner SVG path through ELK's routed points; short segments keep tight corners intact. */
function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return "";
  const first = points[0]!;
  const parts = [`M ${first.x},${first.y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const r = Math.min(radius, dist(p0, p1) / 2, dist(p1, p2) / 2);
    const a = along(p1, p0, r);
    const b = along(p1, p2, r);
    parts.push(`L ${a.x},${a.y}`, `Q ${p1.x},${p1.y} ${b.x},${b.y}`);
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${last.x},${last.y}`);
  return parts.join(" ");
}
function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function along(from: Point, to: Point, d: number): Point {
  const len = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
}

/**
 * Edge that draws ELK's routed orthogonal polyline. Nodes are locked, so the routed points always
 * match the live endpoints; the bezier branch only covers the dagre fallback layout, which produces
 * no routed points.
 */
const ElkEdge = memo(function ElkEdge(props: EdgeProps) {
  const points = (props.data as { points?: Point[] } | undefined)?.points;
  let path: string;
  if (points && points.length >= 2) {
    path = roundedPath(points);
  } else {
    [path] = getBezierPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
    });
  }
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />;
});

const edgeTypes = { elk: ElkEdge };

/** React Flow canvas. Owns only rendering + focus; all graph shape comes from {@link FlowGraph}. */
export function DagGraph(props: DagGraphProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <DagCanvas {...props} />
    </ReactFlowProvider>
  );
}

function DagCanvas({ graph, selectedId, focus, onSelectNode }: DagGraphProps): JSX.Element {
  // useNodesState/useEdgesState (not raw controlled props): controlled `nodes=` without an
  // onNodesChange handler renders them frozen (RF #002), even with dragging off.
  const [nodes, setNodes, onNodesChange] = useNodesState<ModelNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // The node whose relationships we emphasize: hover wins over selection so you can trace by pointing.
  const focusId = hoveredId ?? selectedId;
  // Edges touching the focused node, and the neighbor set to keep bright while the rest fade.
  const { activeEdges, activeNodes } = useMemo(() => {
    if (!focusId) return { activeEdges: null, activeNodes: null };
    const e = new Set<string>();
    const n = new Set<string>([focusId]);
    for (const edge of graph.edges) {
      if (edge.source === focusId || edge.target === focusId) {
        e.add(edge.id);
        n.add(edge.source);
        n.add(edge.target);
      }
    }
    return { activeEdges: e, activeNodes: n };
  }, [focusId, graph.edges]);
  // Build nodes/edges whenever the graph (layout) changes.
  useEffect(() => {
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "model" as const,
        position: n.position,
        width: n.width,
        height: n.height,
        data: {
          label: n.data.label,
          color: n.data.color,
          nodeType: n.data.nodeType,
          count: n.data.count,
          selected: false,
          dimmed: false,
        },
      })),
    );
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "elk",
        data: { points: e.points },
      })),
    );
  }, [graph, setNodes, setEdges]);
  // Re-derive emphasis (selection ring + focus dimming) without disturbing positions.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selectedId,
          dimmed: activeNodes != null && !activeNodes.has(n.id),
        },
      })),
    );
    setEdges((eds) =>
      eds.map((e) => {
        const active = activeEdges != null && activeEdges.has(e.id);
        const faded = activeEdges != null && !active;
        return {
          ...e,
          style: {
            stroke: active ? "#334155" : "#c3ccd6",
            strokeWidth: active ? 2 : 1.5,
            opacity: faded ? 0.12 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color: active ? "#334155" : "#c3ccd6",
          },
          zIndex: active ? 10 : 0,
        };
      }),
    );
  }, [selectedId, activeEdges, activeNodes, setNodes, setEdges]);
  const { setCenter } = useReactFlow();
  useEffect(() => {
    if (!focus) return;
    const target = graph.nodes.find((n) => n.id === focus.nodeId);
    if (target) {
      setCenter(target.position.x + target.width / 2, target.position.y + target.height / 2, {
        zoom: 1.2,
        duration: 400,
      });
    }
  }, [focus, graph.nodes, setCenter]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
      onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
      onNodeMouseLeave={() => setHoveredId(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.2}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#dbe1e8" gap={20} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => (n.data as ModelNodeData).color} />
    </ReactFlow>
  );
}
