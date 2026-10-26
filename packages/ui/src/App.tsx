import { useEffect, useMemo, useRef, useState } from "react";
import type { DataformNode, NodeType } from "@dataform-dag/core";
import type { CompilationStatus, HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import { NODE_COLORS, downstreamOf, indexGraph, upstreamOf } from "./graphToFlow.js";
import { filterGraphByTags, restrictGraph, tagCounts } from "./filterGraph.js";
import { lineageOf } from "./lineage.js";
import { collapseAssertions, isClusterId, type CollapsedGraph } from "./collapseAssertions.js";
import { useLayout } from "./useLayout.js";
import { DagGraph } from "./DagGraph.js";
import { GraphDiagnostics } from "./GraphDiagnostics.js";
import { ClusterDetailPanel } from "./ClusterDetailPanel.js";
import { FocusBar } from "./FocusBar.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import { NodeSearch } from "./NodeSearch.js";
import { ActiveTags, TagFilter } from "./TagFilter.js";
import { TypeIcon } from "./TypeIcon.js";
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
    lineageRequest,
    compilationStatus,
    compilationMessage,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
  } = useHostBridge(bridge);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [groupAssertions, setGroupAssertions] = useState(true);
  /** Focus mode: the real node ids whose lineage is all that's shown (several for a cluster). */
  const [lineage, setLineage] = useState<string[] | null>(null);
  /** Hops each way from the focused node(s); null shows the whole lineage. */
  const [lineageDepth, setLineageDepth] = useState<number | null>(null);
  const { capabilities } = bridge;

  // The host owns persistence, not the filter itself: it sends `tagFilterState` once on restore and
  // the UI drives every change from there. Seeding on each arrival (rather than once) is safe only
  // because the host never echoes `setTagFilter` back.
  useEffect(() => {
    if (savedTagFilter) setSelectedTags(savedTagFilter);
  }, [savedTagFilter]);

  const tags = useMemo(() => (graph ? tagCounts(graph) : NO_TAGS), [graph]);
  const visibleGraph = useMemo(
    () => (graph ? filterGraphByTags(graph, selectedTags) : null),
    [graph, selectedTags],
  );
  // Focus mode narrows the tag-filtered graph further, to the focused node's lineage. It is computed
  // on what the tag filter left, so a root the filter hides means focus has nothing to show — the
  // effect below then leaves focus mode rather than drawing an empty canvas.
  const focused = useMemo(() => {
    if (!lineage || !visibleGraph) return null;
    const present = new Set(visibleGraph.nodes.map((n) => n.id));
    if (!lineage.every((id) => present.has(id))) return null;
    const all = lineageOf(visibleGraph, lineage, null);
    const shown = lineageDepth === null ? all : lineageOf(visibleGraph, lineage, lineageDepth);
    return { shown, maxDepth: all.hops, graph: restrictGraph(visibleGraph, shown.keep) };
  }, [lineage, lineageDepth, visibleGraph]);
  useEffect(() => {
    if (lineage && visibleGraph && !focused) setLineage(null);
  }, [lineage, visibleGraph, focused]);
  const shownGraph = focused?.graph ?? visibleGraph;
  // filter (tags → lineage) → collapse → layout. Collapsing after the filters is what keeps a
  // cluster describing only the assertions still on screen. It runs even when grouping is off — it
  // is O(nodes), and its result is what tells us whether there is anything to group at all.
  const grouping: CollapsedGraph | null = useMemo(
    () => (shownGraph ? collapseAssertions(shownGraph) : null),
    [shownGraph],
  );
  const ungrouped: CollapsedGraph | null = useMemo(
    () => (shownGraph ? { graph: shownGraph, members: NO_MEMBERS, clusterOf: NO_CLUSTERS } : null),
    [shownGraph],
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
  // `jump` is the node to pan to, from either the host or the search box — one stream, so whichever
  // asked last wins. Each request gets a fresh nonce so asking for the same node twice still pans.
  const jumpCount = useRef(0);
  const [jump, setJump] = useState<{ nodeId: string; nonce: number } | null>(null);
  const jumpTo = (nodeId: string): void => setJump({ nodeId, nonce: ++jumpCount.current });
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === handledFocus.current) return;
    handledFocus.current = focusRequest.nonce;
    jumpTo(focusRequest.nodeId);
    const clusterId = collapsed?.clusterOf.get(focusRequest.nodeId);
    if (clusterId) setSelection({ canvasId: clusterId, memberId: focusRequest.nodeId });
  }, [focusRequest, collapsed]);

  const focus = useMemo(() => {
    if (!jump) return null;
    const clusterId = collapsed?.clusterOf.get(jump.nodeId);
    return clusterId ? { nodeId: clusterId, nonce: jump.nonce } : jump;
  }, [jump, collapsed]);

  /** Search picks a node to look at: select it AND bring it into view. */
  const selectAndJump = (nodeId: string): void => {
    select(nodeId);
    jumpTo(nodeId);
  };

  /**
   * Enter focus mode on what's on the canvas: a cluster focuses all of its members together (they
   * share every parent, so their lineage is one picture), anything else focuses that one node.
   * A single root is never re-collapsed — its siblings aren't its lineage — so selecting it by its
   * own id stays valid after the graph narrows; a cluster keeps its id because its parents stay.
   */
  const focusOn = (canvasId: string): void => {
    const members = collapsed?.members.get(canvasId);
    setLineage(members ? members.map((m) => m.id) : [canvasId]);
    setLineageDepth(null);
    setSelection({ canvasId, memberId: null });
  };
  const exitFocus = (): void => setLineage(null);

  const handledLineage = useRef(0);
  useEffect(() => {
    if (!lineageRequest || lineageRequest.nonce === handledLineage.current) return;
    handledLineage.current = lineageRequest.nonce;
    setLineage([lineageRequest.nodeId]);
    setLineageDepth(null);
    setSelection({ canvasId: lineageRequest.nodeId, memberId: null });
  }, [lineageRequest]);

  // Escape leaves focus mode. On `window`, so it runs after the popovers' document listeners: an
  // Escape that closed a menu arrives here already `defaultPrevented` and is ignored.
  useEffect(() => {
    if (!lineage) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || t?.closest("input, textarea")) return;
      setLineage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lineage]);

  /** The canvas ids standing for the focused node(s) — a cluster's members draw as the cluster. */
  const rootIds = useMemo(
    () =>
      lineage && focused ? [...new Set(lineage.map((id) => collapsed?.clusterOf.get(id) ?? id))] : NO_IDS,
    [lineage, focused, collapsed],
  );
  const isFocusRoot = (ids: string[]): boolean =>
    !!lineage && lineage.length === ids.length && ids.every((id) => lineage.includes(id));

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
  const typeOf = (id: string): NodeType | undefined =>
    index?.byId.get(id)?.type ?? (isClusterId(id) ? "assertion" : undefined);
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
        <div className="ddag-topbar__tools">
          {graph && <NodeSearch nodes={graph.nodes} onSelect={selectAndJump} />}
          <TagFilter tagCounts={tags} selectedTags={selectedTags} onChange={changeTags} />
          {(canGroup || !groupAssertions) && (
            <button
              type="button"
              className={`ddag-tool ddag-switch${groupAssertions ? " is-on" : ""}`}
              aria-pressed={groupAssertions}
              onClick={toggleGrouping}
              title="Collapse assertions that check the same models into one node"
            >
              <span className="ddag-switch__track" aria-hidden="true" />
              Group assertions
            </button>
          )}
          {graph && <GraphDiagnostics issues={graph.issues} onSelectNode={selectAndJump} />}
        </div>
        <div className="ddag-topbar__meta">
          {shownGraph && <Legend nodes={shownGraph.nodes} />}
          {collapsed && graph && (
            <span className="ddag-topbar__count">
              {collapsed.graph.nodes.length === graph.nodes.length
                ? `${graph.nodes.length} nodes`
                : `${collapsed.graph.nodes.length} of ${graph.nodes.length} nodes`}
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
              className="ddag-tool"
              onClick={() => bridge.send({ type: "requestRefresh" })}
            >
              Refresh
            </button>
          )}
        </div>
      </header>
      <ActiveTags selectedTags={selectedTags} onChange={changeTags} />
      {lineage && focused && (
        <FocusBar
          label={lineage.length > 1 ? `${lineage.length} assertions` : lineage[0]!}
          type={lineage.length > 1 ? "assertion" : (index?.byId.get(lineage[0]!)?.type ?? "table")}
          upstream={focused.shown.upstream}
          downstream={focused.shown.downstream}
          depth={lineageDepth}
          maxDepth={focused.maxDepth}
          onDepthChange={setLineageDepth}
          onExit={exitFocus}
        />
      )}
      <div className="ddag-body">
        <main className="ddag-canvas">
          {flow ? (
            <DagGraph
              graph={flow}
              selectedId={selection?.canvasId ?? null}
              focus={focus}
              onSelectNode={select}
              onFocusNode={focusOn}
              rootIds={rootIds}
              fitKey={`${selectedTags.join("\u0000")}|${groupAssertions}|${
                focused ? lineage!.join("\u0000") : ""
              }|${lineageDepth}`}
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
            typeOf={typeOf}
            highlightedId={selection.memberId}
            onSelect={select}
            onClose={() => select(null)}
            onFocus={
              isFocusRoot(clusterMembers.map((m) => m.id))
                ? undefined
                : () => focusOn(selection.canvasId)
            }
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
            typeOf={typeOf}
            onSelect={select}
            onClose={() => select(null)}
            onFocus={isFocusRoot([selected.id]) ? undefined : () => focusOn(selected.id)}
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
const NO_TAGS = new Map<string, number>();
const NO_IDS: string[] = [];

const STATUS_LABEL: Record<CompilationStatus, string> = {
  idle: "",
  compiling: "Compiling…",
  ready: "Compiled",
  error: "Compile failed",
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
      role="status"
    >
      <span className="ddag-status__dot" aria-hidden="true" />
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
  return (
    <div className="ddag-empty">
      <div className="ddag-empty__box ddag-empty__box--quiet">
        <span className="ddag-empty__pulse" aria-hidden="true" />
        Compiling the project…
      </div>
    </div>
  );
}

/** The type key, counting what's on screen, so it doubles as a summary of the filtered graph. */
function Legend({ nodes }: { nodes: DataformNode[] }): JSX.Element {
  const counts = new Map<NodeType, number>();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  return (
    <ul className="ddag-legend" aria-label="Node types">
      {(Object.keys(NODE_COLORS) as NodeType[]).map((type) => (
        <li
          key={type}
          className={`ddag-legend__item${counts.has(type) ? "" : " is-absent"}`}
          style={{ ["--type" as string]: NODE_COLORS[type] }}
          title={`${counts.get(type) ?? 0} ${type}`}
        >
          <TypeIcon type={type} />
          <span className="ddag-legend__name">{type}</span>
          <span className="ddag-legend__count">{counts.get(type) ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}
