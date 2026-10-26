import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  getBezierPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeType } from "@dataform-dag/core";
import type { FlowGraph, FlowNode, Point } from "./graphToFlow.js";
import { TypeIcon } from "./TypeIcon.js";

export interface DagGraphProps {
  graph: FlowGraph;
  selectedId: string | null;
  /** Bumped by the host asking to focus a node; pans/zooms to it. */
  focus: { nodeId: string; nonce: number } | null;
  /** A node id to select, or null to clear the selection (e.g. clicking empty canvas). */
  onSelectNode: (nodeId: string | null) => void;
  /** Double-click: enter focus mode on this canvas node (a real id or a cluster id). */
  onFocusNode?: (nodeId: string) => void;
  /** The focused node(s) while in focus mode, drawn as the anchor of the lineage. */
  rootIds?: string[];
  /** Nodes shown only as neighbors of a tag match, drawn dashed and faded. */
  contextIds?: string[];
  /**
   * Changes when the user changes what's shown (tag filter, grouping). The next layout that lands
   * after a change is fitted to the view; any other relayout (a recompile) keeps the view anchored.
   */
  fitKey?: string;
}

type ModelNodeData = {
  label: string;
  color: string;
  nodeType: NodeType;
  selected: boolean;
  dimmed: boolean;
  /** The anchor of focus mode. */
  root: boolean;
  /** Shown as a neighbor of the tag filter's matches, not as a match. */
  context: boolean;
  /** Set when this node stands for several collapsed ones — see `collapseAssertions`. */
  count?: number;
};
type ModelNode = Node<ModelNodeData, "model">;

/**
 * A model as a card: a type tab with the type's glyph, then the monospace name over the type. Sized
 * by its label (see `nodeWidth`).
 */
const ModelNode = memo(function ModelNode({ data }: NodeProps<ModelNode>) {
  const cls = `ddag-node${data.selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}${
    data.count ? " is-cluster" : ""
  }${data.root ? " is-root" : ""}${data.context ? " is-context" : ""}`;
  return (
    <div
      className={cls}
      style={{ ["--type" as string]: data.color }}
      title={data.context ? "Not tagged with the filter: shown as a neighbor of a match" : undefined}
    >
      <Handle type="target" position={Position.Left} className="ddag-node__port" />
      <span className="ddag-node__tab">
        <TypeIcon type={data.nodeType} />
      </span>
      <span className="ddag-node__text">
        <span className="ddag-node__label">{data.label}</span>
        {/* A cluster's own label already names the type, so the sub-label says what it IS instead. */}
        <span className="ddag-node__type">{data.count ? "grouped" : data.nodeType}</span>
      </span>
      <Handle type="source" position={Position.Right} className="ddag-node__port" />
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
  // Arrowheads come from the <defs> in EdgeMarkers rather than React Flow's markers: those are keyed
  // by color string, and these colors are CSS variables that follow the editor theme.
  const active = (props.data as { active?: boolean } | undefined)?.active;
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={active ? "url(#ddag-arrow-active)" : "url(#ddag-arrow)"}
      style={props.style}
    />
  );
});

const edgeTypes = { elk: ElkEdge };

function EdgeMarkers(): JSX.Element {
  return (
    <svg className="ddag-markers" aria-hidden="true">
      <defs>
        {(["ddag-arrow", "ddag-arrow-active"] as const).map((id) => (
          <marker
            key={id}
            id={id}
            viewBox="-6 -5 8 10"
            markerWidth="8"
            markerHeight="10"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M-5,-4 L1,0 L-5,4 z" className={`${id}__head`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

const NO_ROOTS: string[] = [];

/** Framing for every fit. The zoom cap keeps a filter down to two nodes from blowing them up 2×. */
const FIT = { padding: 0.2, maxZoom: 1.25 };

/** Should the viewer's motion preference allow the animated fit after a filter change? */
const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** React Flow canvas. Owns only rendering + focus; all graph shape comes from {@link FlowGraph}. */
export function DagGraph(props: DagGraphProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <DagCanvas {...props} />
    </ReactFlowProvider>
  );
}

function DagCanvas({
  graph,
  selectedId,
  focus,
  onSelectNode,
  onFocusNode,
  rootIds = NO_ROOTS,
  contextIds = NO_ROOTS,
  fitKey = "",
}: DagGraphProps): JSX.Element {
  // useNodesState/useEdgesState (not raw controlled props): controlled `nodes=` without an
  // onNodesChange handler renders them frozen (RF #002), even with dragging off.
  const [nodes, setNodes, onNodesChange] = useNodesState<ModelNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const roots = useMemo(() => new Set(rootIds), [rootIds]);
  const contextSet = useMemo(() => new Set(contextIds), [contextIds]);
  // The node whose relationships we emphasize: hover wins over selection so you can trace by pointing.
  // A selected focus root doesn't dim anything: in focus mode everything on screen IS its lineage,
  // and dimming all but its direct neighbors would grey out the rest of what you asked to see.
  const focusId = hoveredId ?? (selectedId && !roots.has(selectedId) ? selectedId : null);
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
  const { fitView, getViewport, setViewport, setCenter } = useReactFlow();
  const storeApi = useStoreApi();
  // fitKey is read through a ref so a filter change arms the NEXT layout, which lands asynchronously.
  const fitKeyRef = useRef(fitKey);
  fitKeyRef.current = fitKey;
  const fittedKey = useRef(fitKey);
  const previous = useRef<FlowNode[] | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const [relayout, setRelayout] = useState(0);

  // Build nodes/edges whenever the graph (layout) changes, then decide where the view goes: nodes
  // move in a new layout, and leaving the viewport where it was is what made the graph "jump".
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
          root: false,
          context: false,
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

    const before = previous.current;
    previous.current = graph.nodes;
    if (!before) return; // the first layout is fitted by <ReactFlow fitView>
    setRelayout((n) => n + 1);
    const duration = prefersReducedMotion() ? 0 : 380;

    if (fittedKey.current !== fitKeyRef.current) {
      // The user changed what's shown: frame the result. Deferred a frame so React Flow has the new
      // nodes in its store before measuring bounds.
      fittedKey.current = fitKeyRef.current;
      requestAnimationFrame(() => void fitView({ ...FIT, duration }));
      return;
    }
    // A recompile: hold the node you were looking at still on screen — the selection if it
    // survived, else whichever surviving node was nearest the middle of the view.
    const anchor = anchorBetween(before, graph.nodes, selectedRef.current, viewCenter());
    if (!anchor) {
      requestAnimationFrame(() => void fitView({ ...FIT, duration }));
      return;
    }
    const { x, y, zoom } = getViewport();
    void setViewport({
      x: x - (anchor.after.x - anchor.before.x) * zoom,
      y: y - (anchor.after.y - anchor.before.y) * zoom,
      zoom,
    });

    function viewCenter(): { x: number; y: number } {
      const { width, height } = storeApi.getState();
      const v = getViewport();
      return { x: (width / 2 - v.x) / v.zoom, y: (height / 2 - v.y) / v.zoom };
    }
    // Only the graph drives this; the callbacks are stable and fitKey/selection are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, setNodes, setEdges]);
  // Re-derive emphasis (selection ring, dimming, focus root, context) without disturbing positions.
  // `graph` is a dependency too: the build effect above resets every flag when a layout lands, and
  // layouts land asynchronously, AFTER the render that changed the selection/root/context sets —
  // without it, emphasis applied to the old nodes would be wiped and never reapplied.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selectedId,
          dimmed: activeNodes != null && !activeNodes.has(n.id),
          root: roots.has(n.id),
          context: contextSet.has(n.id),
        },
      })),
    );
    setEdges((eds) =>
      eds.map((e) => {
        const active = activeEdges != null && activeEdges.has(e.id);
        const faded = activeEdges != null && !active;
        return {
          ...e,
          // React Flow's own `animated` dash, running source → target: on hover it shows which
          // way data moves through the node you're pointing at.
          animated: active,
          className: active ? "is-active" : faded ? "is-faded" : undefined,
          data: { ...e.data, active },
          zIndex: active ? 10 : 0,
        };
      }),
    );
  }, [graph, selectedId, activeEdges, activeNodes, roots, contextSet, setNodes, setEdges]);
  // Each jump pans once. Re-panning on every relayout would undo the fit/anchor above; a jump whose
  // node isn't laid out yet (a filter just changed) waits for the layout that has it.
  const jumped = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === jumped.current) return;
    const target = graph.nodes.find((n) => n.id === focus.nodeId);
    if (!target) return;
    jumped.current = focus.nonce;
    // Deferred a frame: selecting can open the detail panel in the same render, which narrows the
    // canvas, and centering against the old width would leave the node under the panel.
    const frame = requestAnimationFrame(() =>
      void setCenter(target.position.x + target.width / 2, target.position.y + target.height / 2, {
        zoom: Math.max(getViewport().zoom, 1),
        duration: prefersReducedMotion() ? 0 : 400,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focus, graph.nodes, setCenter]);
  return (
    // data-relayout flips on each relayout, and app.css gives each value its own (identical) fade
    // keyframes, so the fade replays: new positions land in one frame, and a short fade reads as
    // "re-arranged" rather than a teleport.
    <div className="ddag-flow" data-relayout={relayout % 2}>
      <EdgeMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDoubleClick={(_, node) => onFocusNode?.(node.id)}
        // Double-click on a node means "focus it"; zooming on it too would fight the fit that follows.
        zoomOnDoubleClick={false}
        onPaneClick={() => onSelectNode(null)}
        onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.2}
        fitView
        fitViewOptions={FIT}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--ddag-grid)" gap={22} size={1.5} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => (n.data as ModelNodeData).color}
          nodeBorderRadius={4}
          maskColor="var(--ddag-minimap-mask)"
        />
      </ReactFlow>
    </div>
  );
}

/**
 * The node to hold still across a relayout, with its position before and after. Prefers the
 * selection; otherwise the surviving node closest to `center` (flow coordinates).
 */
export function anchorBetween(
  before: FlowNode[],
  after: FlowNode[],
  selectedId: string | null,
  center: { x: number; y: number },
): { before: { x: number; y: number }; after: { x: number; y: number } } | null {
  const now = new Map(after.map((n) => [n.id, n.position]));
  const pick = (n: FlowNode) => ({ before: n.position, after: now.get(n.id)! });
  const selected = selectedId ? before.find((n) => n.id === selectedId && now.has(n.id)) : undefined;
  if (selected) return pick(selected);
  let best: FlowNode | undefined;
  let bestDist = Infinity;
  for (const n of before) {
    if (!now.has(n.id)) continue;
    const d = Math.hypot(n.position.x + n.width / 2 - center.x, n.position.y + n.height / 2 - center.y);
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best ? pick(best) : null;
}
