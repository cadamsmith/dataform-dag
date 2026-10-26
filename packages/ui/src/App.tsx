import { useEffect, useMemo, useRef, useState } from "react";
import type { DataformNode } from "@dataform-dag/core";
import type { CompilationStatus, HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import { NODE_COLORS, downstreamOf, indexGraph, upstreamOf } from "./graphToFlow.js";
import { allTags, filterGraphByTags } from "./filterGraph.js";
import { collapseAssertions, isClusterId, type CollapsedGraph } from "./collapseAssertions.js";
import { useLayout } from "./useLayout.js";
import { DagGraph } from "./DagGraph.js";
import { GraphDiagnostics } from "./GraphDiagnostics.js";
import { ClusterDetailPanel } from "./ClusterDetailPanel.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import { NodeSearch } from "./NodeSearch.js";
import { TagFilter } from "./TagFilter.js";
import "./app.css";

export interface AppProps {
  bridge: HostBridge;
}

/** What the canvas has selected, plus the real node the user asked for if a cluster stands in for it. */
interface Selection {
  canvasId: string;
  memberId: string | null;
}

/** Host-agnostic root. Knows nothing about which host embeds it — only {@link HostBridge}. */
export function App({ bridge }: AppProps): JSX.Element {
  const {
    graph,
    focusRequest,
    compilationStatus,
    compilationMessage,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
  } = useHostBridge(bridge);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [groupAssertions, setGroupAssertions] = useState(true);
  const { capabilities } = bridge;

  // The host owns persistence, not the filter itself: it sends `tagFilterState` once on restore and
  // the UI drives every change from there. Seeding on each arrival (rather than once) is safe only
  // because the host never echoes `setTagFilter` back.
  useEffect(() => {
    if (savedTagFilter) setSelectedTags(savedTagFilter);
  }, [savedTagFilter]);

  const availableTags = useMemo(() => (graph ? allTags(graph) : []), [graph]);
  const visibleGraph = useMemo(
    () => (graph ? filterGraphByTags(graph, selectedTags) : null),
    [graph, selectedTags],
  );
  // filter → collapse → layout. Collapsing after the filter is what keeps a cluster describing only
  // the assertions still on screen. It runs even when grouping is off — it is O(nodes), and its
  // result is what tells us whether this project has anything to group at all.
  const grouping: CollapsedGraph | null = useMemo(
    () => (visibleGraph ? collapseAssertions(visibleGraph) : null),
    [visibleGraph],
  );
  const ungrouped: CollapsedGraph | null = useMemo(
    () =>
      visibleGraph ? { graph: visibleGraph, members: NO_MEMBERS, clusterOf: NO_CLUSTERS } : null,
    [visibleGraph],
  );
  const collapsed = groupAssertions ? grouping : ungrouped;
  const flow = useLayout(collapsed?.graph ?? null);
  // Index the UNFILTERED graph so the detail panel reports a node's true dependencies, and so a
  // diagnostic can link to a node the current tag filter happens to hide.
  const index = useMemo(() => (graph ? indexGraph(graph) : null), [graph]);

  /**
   * Selection arrives as a REAL node id from search, diagnostics, and the host — but a collapsed
   * assertion has no node on the canvas, so every one of those paths resolves through here.
   */
  const select = (nodeId: string | null): void => {
    if (nodeId === null) {
      setSelection(null);
      return;
    }
    const clusterId = collapsed?.clusterOf.get(nodeId);
    setSelection(
      clusterId ? { canvasId: clusterId, memberId: nodeId } : { canvasId: nodeId, memberId: null },
    );
  };

  // A host focus request (active editor, tree reveal) pans the canvas. When its target is collapsed,
  // also select the cluster: panning to a node that doesn't name what you asked for is meaningless
  // on its own, and the panel is where the member becomes visible again.
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === handledFocus.current) return;
    handledFocus.current = focusRequest.nonce;
    const clusterId = collapsed?.clusterOf.get(focusRequest.nodeId);
    if (clusterId) setSelection({ canvasId: clusterId, memberId: focusRequest.nodeId });
  }, [focusRequest, collapsed]);

  const focus = useMemo(() => {
    if (!focusRequest) return null;
    const clusterId = collapsed?.clusterOf.get(focusRequest.nodeId);
    return clusterId ? { nodeId: clusterId, nonce: focusRequest.nonce } : focusRequest;
  }, [focusRequest, collapsed]);

  const clusterMembers = selection ? (collapsed?.members.get(selection.canvasId) ?? null) : null;
  const selected: DataformNode | null =
    (!clusterMembers && index && selection && index.byId.get(selection.canvasId)) || null;
  /**
   * A cluster's neighbors come from the COLLAPSED graph, not the index: the index describes the
   * unfiltered project, where two members can share a filtered ref-set while differing in their true
   * refs — the panel would then show one arbitrary member's upstream instead of the cluster's.
   */
  const clusterNeighbors = useMemo(() => {
    if (!clusterMembers || !collapsed || !selection) return null;
    const node = collapsed.graph.nodes.find((n) => n.id === selection.canvasId);
    const downstream = new Map(collapsed.graph.downstream).get(selection.canvasId) ?? [];
    return { upstream: node?.refs ?? [], downstream };
  }, [clusterMembers, collapsed, selection]);
  // Only offer the switch when this project actually has assertions sharing a position.
  const canGroup = (grouping?.members.size ?? 0) > 0;

  /** Toggling must not strand the selection on a node that is about to stop existing. */
  const toggleGrouping = (): void => {
    if (groupAssertions) {
      setSelection((sel) => {
        if (!sel || !isClusterId(sel.canvasId)) return sel;
        const fallback = sel.memberId ?? grouping?.members.get(sel.canvasId)?.[0]?.id;
        return fallback ? { canvasId: fallback, memberId: null } : null;
      });
    } else {
      setSelection((sel) => {
        const clusterId = sel && grouping?.clusterOf.get(sel.canvasId);
        return clusterId ? { canvasId: clusterId, memberId: sel!.canvasId } : sel;
      });
    }
    setGroupAssertions((on) => !on);
  };

  const changeTags = (next: string[]): void => {
    setSelectedTags(next);
    bridge.send({ type: "setTagFilter", selectedTags: next });
  };

  const openFile = capabilities.openFile
    ? (node: DataformNode) =>
        bridge.send({ type: "openFile", nodeId: node.id, filePath: node.filePath })
    : undefined;
  const showCompiledSql = capabilities.compiledSql
    ? (node: DataformNode) =>
        bridge.send({ type: "showCompiledSql", nodeId: node.id, filePath: node.filePath })
    : undefined;

  return (
    <div className="ddag-app">
      <header className="ddag-topbar">
        <h1 className="ddag-topbar__title">dataform-dag</h1>
        <Legend />
        <div className="ddag-topbar__spacer" />
        {graph && <NodeSearch nodeIds={graph.nodes.map((n) => n.id)} onSelect={select} />}
        <TagFilter
          availableTags={availableTags}
          selectedTags={selectedTags}
          onChange={changeTags}
        />
        {(canGroup || !groupAssertions) && (
          <button
            type="button"
            className={`ddag-btn ddag-btn--toggle${groupAssertions ? " is-on" : ""}`}
            aria-pressed={groupAssertions}
            onClick={toggleGrouping}
            title="Collapse assertions that share the same dependencies into one node"
          >
            group assertions
          </button>
        )}
        {graph && (
          <GraphDiagnostics issues={graph.issues} onSelectNode={select} />
        )}
        {collapsed && (
          <span className="ddag-topbar__count">
            {collapsed.graph.nodes.length}
            {graph && collapsed.graph.nodes.length !== graph.nodes.length
              ? ` / ${graph.nodes.length}`
              : ""}{" "}
            nodes
          </span>
        )}
        <CompileStatus
          status={compilationStatus}
          message={compilationMessage}
          stale={graph !== null}
        />
        {!capabilities.liveWatch && (
          <button
            type="button"
            className="ddag-btn"
            onClick={() => bridge.send({ type: "requestRefresh" })}
          >
            Refresh
          </button>
        )}
      </header>
      <div className="ddag-body">
        <main className="ddag-canvas">
          {flow ? (
            <DagGraph
              graph={flow}
              selectedId={selection?.canvasId ?? null}
              focus={focus}
              onSelectNode={select}
            />
          ) : (
            <EmptyState status={compilationStatus} message={compilationMessage} />
          )}
        </main>
        {clusterMembers && index && selection && (
          <ClusterDetailPanel
            members={clusterMembers}
            upstream={clusterNeighbors?.upstream ?? []}
            downstream={clusterNeighbors?.downstream ?? []}
            highlightedId={selection.memberId}
            onSelect={select}
            onOpenFile={openFile}
            onShowCompiledSql={showCompiledSql}
            compiledSql={compiledSql}
            compiledSqlError={compiledSqlError}
          />
        )}
        {selected && index && (
          <NodeDetailPanel
            node={selected}
            upstream={upstreamOf(index, selected.id)}
            downstream={downstreamOf(index, selected.id)}
            onSelect={select}
            onOpenFile={openFile}
            onShowCompiledSql={showCompiledSql}
            // Gate on nodeId so SQL fetched for a previous selection never renders under this one.
            compiledSql={compiledSql?.nodeId === selected.id ? compiledSql.sections : null}
            compiledSqlError={
              compiledSqlError?.nodeId === selected.id ? compiledSqlError.message : null
            }
          />
        )}
      </div>
    </div>
  );
}

/** Stable empties for the un-collapsed path, so the memo doesn't hand React a new object each render. */
const NO_MEMBERS: CollapsedGraph["members"] = new Map();
const NO_CLUSTERS: CollapsedGraph["clusterOf"] = new Map();

const STATUS_LABEL: Record<CompilationStatus, string> = {
  idle: "",
  compiling: "compiling…",
  ready: "compiled",
  error: "compile failed",
  "cli-missing": "Dataform CLI not found",
};

const CLI_HINT =
  "Install it with `npm i -g @dataform/cli`, add it to the project, or set `dataformDag.cliPath`.";

/**
 * The status pill. `stale` means a graph is still on screen, so a failure reads as "this is the last
 * good graph" rather than as an empty canvas; the compiler's message is in the tooltip.
 */
function CompileStatus({
  status,
  message,
  stale,
}: {
  status: CompilationStatus;
  message: string | null;
  stale: boolean;
}): JSX.Element | null {
  if (status === "idle") return null;
  const failed = status === "error" || status === "cli-missing";
  return (
    <span
      className={`ddag-status ddag-status--${failed ? "error" : status}`}
      title={message ?? undefined}
    >
      {STATUS_LABEL[status]}
      {failed && stale ? " — showing last good graph" : ""}
    </span>
  );
}

/** What the canvas shows before the first successful compile. */
function EmptyState({
  status,
  message,
}: {
  status: CompilationStatus;
  message: string | null;
}): JSX.Element {
  if (status === "cli-missing") {
    return (
      <div className="ddag-empty">
        <div className="ddag-empty__box">
          <strong>Dataform CLI not found.</strong>
          <p>{CLI_HINT}</p>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="ddag-empty">
        <div className="ddag-empty__box">
          <strong>The project failed to compile.</strong>
          {message && <pre className="ddag-empty__message">{message}</pre>}
        </div>
      </div>
    );
  }
  return <div className="ddag-empty">Compiling the project…</div>;
}

function Legend(): JSX.Element {
  return (
    <ul className="ddag-legend">
      {(Object.keys(NODE_COLORS) as (keyof typeof NODE_COLORS)[]).map((type) => (
        <li key={type} className="ddag-legend__item">
          <span className="ddag-legend__dot" style={{ background: NODE_COLORS[type] }} />
          {type}
        </li>
      ))}
    </ul>
  );
}
