import { useEffect, useMemo, useRef, useState } from "react";
import type { DataformNode, NodeType } from "@dataform-dag/core";
import type { CompilationStatus, HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import { NODE_COLORS, downstreamOf, indexGraph, upstreamOf } from "./graphToFlow.js";
import { filterGraphWithContext, restrictGraph, tagCounts } from "./filterGraph.js";
import { depthWithin, lineageOf } from "./lineage.js";
import { collapseAssertions, isClusterId, type CollapsedGraph } from "./collapseAssertions.js";
import {
  ancestorsOf,
  collapseFolders,
  folderId,
  folderPathOf,
  folderTree,
  isFolderId,
} from "./collapseFolders.js";
import { FolderDetailPanel } from "./FolderDetailPanel.js";
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

/**
 * Above this many nodes the panel opens on its folders collapsed (or, for a project with no folders,
 * on a start screen) rather than drawing every node, and focus mode limits its depth so the lineage
 * it draws stays about this size.
 */
export const LARGE_GRAPH = 300;

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
    startRequest,
    compilationStatus,
    compilationMessage,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
  } = useHostBridge(bridge);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [groupAssertions, setGroupAssertions] = useState(true);
  /** With a tag filter on, also show each match's direct neighbors (as context). */
  const [showContext, setShowContext] = useState(false);
  /** Focus mode: the real node ids whose lineage is all that's shown (several for a cluster). */
  const [lineage, setLineage] = useState<string[] | null>(null);
  /** Hops each way from the focused node(s); null shows the whole lineage. */
  const [lineageDepth, setLineageDepth] = useState<number | null>(null);
  /** The user asked for the whole of a large project anyway. */
  const [showAll, setShowAll] = useState(false);
  /** Group by folder, once the user has said; until then it's on for a large project. */
  const [folderChoice, setFolderChoice] = useState<boolean | null>(null);
  /** Folder paths opened up on the canvas; any folder not in here is drawn as one node. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_FOLDERS);
  const { capabilities } = bridge;

  // The host owns persistence, not the filter itself: it sends `tagFilterState` once on restore and
  // the UI drives every change from there. Seeding on each arrival (rather than once) is safe only
  // because the host never echoes `setTagFilter` back.
  useEffect(() => {
    if (savedTagFilter) setSelectedTags(savedTagFilter);
  }, [savedTagFilter]);

  const tags = useMemo(() => (graph ? tagCounts(graph) : NO_TAGS), [graph]);
  const tree = useMemo(() => (graph ? folderTree(graph.nodes) : null), [graph]);
  const isLarge = !!graph && graph.nodes.length > LARGE_GRAPH;
  const groupFolders = (folderChoice ?? isLarge) && !!tree?.hasFolders;
  const tagFiltered = useMemo(
    () => (graph ? filterGraphWithContext(graph, selectedTags, showContext) : null),
    [graph, selectedTags, showContext],
  );
  const visibleGraph = tagFiltered?.graph ?? null;
  const context = tagFiltered?.context ?? NO_CONTEXT;
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
  // A large project with no folders to group and nothing chosen yet draws nothing: no layout runs
  // until the user picks a node, a tag, or "show all". Every way out of focus mode lands back here.
  const atStart =
    isLarge && !showAll && !focused && selectedTags.length === 0 && !groupFolders;
  const shownGraph = atStart ? null : (focused?.graph ?? visibleGraph);
  // filter (tags → lineage) → collapse folders → collapse assertions → layout. Collapsing after the
  // filters is what keeps a group describing only what is still on screen. Neither a tag filter nor
  // focus mode is folder-grouped: each is already a narrow view you asked for, node by node (and the
  // tag filter's context marking only knows real nodes).
  const foldering = groupFolders && !focused && selectedTags.length === 0;
  const folders = useMemo(
    () => (shownGraph && tree && foldering ? collapseFolders(shownGraph, tree, expanded) : null),
    [shownGraph, tree, foldering, expanded],
  );
  const folderedGraph = folders?.graph ?? shownGraph;
  // Assertion grouping runs even when it is off — it is O(nodes), and its result is what tells us
  // whether there is anything to group at all.
  const grouping: CollapsedGraph | null = useMemo(
    () => (folderedGraph ? collapseAssertions(folderedGraph) : null),
    [folderedGraph],
  );
  const ungrouped: CollapsedGraph | null = useMemo(
    () =>
      folderedGraph ? { graph: folderedGraph, members: NO_MEMBERS, clusterOf: NO_CLUSTERS } : null,
    [folderedGraph],
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
    // Asking for a node inside a collapsed folder opens the folders above it. If it then lands in an
    // assertion cluster, the effect below moves the selection onto that cluster.
    if (folders?.folderOf.has(nodeId)) {
      reveal(nodeId);
      setSelection({ canvasId: nodeId, memberId: null });
      return;
    }
    const clusterId = collapsed?.clusterOf.get(nodeId);
    setSelection(
      clusterId ? { canvasId: clusterId, memberId: nodeId } : { canvasId: nodeId, memberId: null },
    );
  };

  useEffect(() => {
    const clusterId = selection && collapsed?.clusterOf.get(selection.canvasId);
    if (clusterId) setSelection({ canvasId: clusterId, memberId: selection!.canvasId });
  }, [selection, collapsed]);

  /** Expand every folder above a node, so it is drawn itself. */
  const reveal = (nodeId: string): void => {
    const path = tree?.folderOfNode.get(nodeId);
    if (!path) return;
    setExpanded((prev) => new Set([...prev, ...ancestorsOf(path)]));
  };
  const expandFolder = (id: string): void => {
    setExpanded((prev) => new Set([...prev, folderPathOf(id)]));
    setSelection(null);
  };
  /** Fold a folder (and everything opened inside it) back into one node, and select that node. */
  const collapseFolder = (path: string): void => {
    setExpanded((prev) => new Set([...prev].filter((p) => p !== path && !p.startsWith(`${path}/`))));
    setSelection({ canvasId: folderId(path), memberId: null });
  };
  /** The innermost expanded folder at or above `path`: the one a "collapse" folds up. */
  const expandedAbove = (path: string): string | null =>
    ancestorsOf(path).filter((p) => expanded.has(p)).pop() ?? null;

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
    // On the start screen there is nothing to pan to: the node the host points at (the file open in
    // the editor) becomes the starting point instead.
    if (atStart) {
      enterFocus([focusRequest.nodeId], focusRequest.nodeId);
      return;
    }
    jumpTo(focusRequest.nodeId);
    const clusterId = collapsed?.clusterOf.get(focusRequest.nodeId);
    if (clusterId) setSelection({ canvasId: clusterId, memberId: focusRequest.nodeId });
    // enterFocus is recreated every render and only reads state; the request is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, collapsed, atStart]);

  const focus = useMemo(() => {
    if (!jump) return null;
    // A node inside a collapsed folder pans to the folder; search reveals it first, the host doesn't.
    const canvasId =
      folders?.folderOf.get(jump.nodeId) ?? collapsed?.clusterOf.get(jump.nodeId) ?? jump.nodeId;
    return canvasId === jump.nodeId ? jump : { nodeId: canvasId, nonce: jump.nonce };
  }, [jump, folders, collapsed]);

  /** Search picks a node to look at: select it AND bring it into view. */
  const selectAndJump = (nodeId: string): void => {
    if (atStart) {
      enterFocus([nodeId], nodeId);
      return;
    }
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
    // A folder's lineage would be most of the project; double-clicking one opens it instead.
    if (isFolderId(canvasId)) {
      expandFolder(canvasId);
      return;
    }
    const members = collapsed?.members.get(canvasId);
    enterFocus(members ? members.map((m) => m.id) : [canvasId], canvasId);
  };
  /** Starts unbounded unless that would draw a large project's worth of nodes — see LARGE_GRAPH. */
  const enterFocus = (ids: string[], canvasId: string): void => {
    setLineage(ids);
    setLineageDepth(visibleGraph ? depthWithin(visibleGraph, ids, LARGE_GRAPH) : null);
    setSelection({ canvasId, memberId: null });
  };
  const exitFocus = (): void => setLineage(null);

  const handledLineage = useRef(0);
  useEffect(() => {
    if (!lineageRequest || lineageRequest.nonce === handledLineage.current) return;
    handledLineage.current = lineageRequest.nonce;
    enterFocus([lineageRequest.nodeId], lineageRequest.nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineageRequest]);

  const handledStart = useRef(0);
  useEffect(() => {
    if (!startRequest || startRequest.nonce === handledStart.current) return;
    handledStart.current = startRequest.nonce;
    if (isLarge && !lineage) enterFocus([startRequest.nodeId], startRequest.nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRequest, isLarge]);

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
  /** Canvas nodes drawn as context: a cluster only when every assertion in it is context. */
  const contextIds = useMemo(() => {
    if (context.size === 0 || !collapsed) return NO_IDS;
    return collapsed.graph.nodes
      .filter((n) => (collapsed.members.get(n.id)?.map((m) => m.id) ?? [n.id]).every((id) => context.has(id)))
      .map((n) => n.id);
  }, [context, collapsed]);

  const isFocusRoot = (ids: string[]): boolean =>
    !!lineage && lineage.length === ids.length && ids.every((id) => lineage.includes(id));

  const clusterMembers = selection ? (collapsed?.members.get(selection.canvasId) ?? null) : null;
  const folderMembers = selection ? (folders?.members.get(selection.canvasId) ?? null) : null;
  const folderNeighbors = useMemo(() => {
    if (!folderMembers || !folders || !selection) return null;
    const node = folders.graph.nodes.find((n) => n.id === selection.canvasId);
    const downstream = new Map(folders.graph.downstream).get(selection.canvasId) ?? [];
    return { upstream: node?.refs ?? [], downstream };
  }, [folderMembers, folders, selection]);
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
          {tree?.hasFolders && !focused && selectedTags.length === 0 && (
            <button
              type="button"
              className={`ddag-tool ddag-switch${groupFolders ? " is-on" : ""}`}
              aria-pressed={groupFolders}
              onClick={() => {
                // Turning grouping off on a large project is asking to see all of it.
                if (groupFolders && isLarge) setShowAll(true);
                setFolderChoice(!groupFolders);
                setSelection(null);
              }}
              title="Draw each folder as one node; double-click a folder to open it"
            >
              <span className="ddag-switch__track" aria-hidden="true" />
              Group by folder
            </button>
          )}
          {foldering && expanded.size > 0 && (
            <button
              type="button"
              className="ddag-tool"
              onClick={() => {
                setExpanded(NO_FOLDERS);
                setSelection(null);
              }}
            >
              Collapse all
            </button>
          )}
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
          {graph && (
            <span className="ddag-topbar__count">
              {!collapsed || collapsed.graph.nodes.length === graph.nodes.length
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
      <ActiveTags
        selectedTags={selectedTags}
        onChange={changeTags}
        showContext={showContext}
        onShowContextChange={setShowContext}
        contextCount={context.size}
      />
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
          {atStart ? (
            <StartScreen
              nodeCount={graph.nodes.length}
              followsEditor={capabilities.focusOnActive}
              onShowAll={() => setShowAll(true)}
            />
          ) : flow ? (
            <DagGraph
              graph={flow}
              selectedId={selection?.canvasId ?? null}
              focus={focus}
              onSelectNode={select}
              onFocusNode={focusOn}
              rootIds={rootIds}
              contextIds={contextIds}
              fitKey={`${selectedTags.join("\u0000")}|${showContext}|${groupAssertions}|${groupFolders}|${
                focused ? lineage!.join("\u0000") : ""
              }|${lineageDepth}`}
            />
          ) : (
            <EmptyState status={compilationStatus} message={compilationMessage} />
          )}
        </main>
        {/* Leaving focus keeps the selection, but on the start screen nothing it names is drawn. */}
        {!atStart && folderMembers && selection && (
          <FolderDetailPanel
            path={folderPathOf(selection.canvasId)}
            members={folderMembers}
            upstream={folderNeighbors?.upstream ?? []}
            downstream={folderNeighbors?.downstream ?? []}
            typeOf={typeOf}
            onSelect={select}
            onExpand={() => expandFolder(selection.canvasId)}
            onCollapseParent={(() => {
              const parent = expandedAbove(folderPathOf(selection.canvasId));
              return parent ? { path: parent, collapse: () => collapseFolder(parent) } : undefined;
            })()}
            onClose={() => select(null)}
          />
        )}
        {!atStart && clusterMembers && index && selection && (
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
        {!atStart && selected && index && (
          <NodeDetailPanel
            node={selected}
            upstream={upstreamOf(index, selected.id)}
            downstream={downstreamOf(index, selected.id)}
            typeOf={typeOf}
            onSelect={select}
            onClose={() => select(null)}
            onFocus={isFocusRoot([selected.id]) ? undefined : () => focusOn(selected.id)}
            folder={(() => {
              const path = folders && expandedAbove(tree?.folderOfNode.get(selected.id) ?? "");
              return path ? { path, collapse: () => collapseFolder(path) } : undefined;
            })()}
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
const NO_FOLDERS: ReadonlySet<string> = new Set();
const NO_CONTEXT: ReadonlySet<string> = new Set();

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

/**
 * What a large project opens on: an invitation to pick a starting point, since drawing (and laying
 * out) every node at once is slow to produce and too dense to read.
 */
function StartScreen({
  nodeCount,
  followsEditor,
  onShowAll,
}: {
  nodeCount: number;
  followsEditor: boolean;
  onShowAll: () => void;
}): JSX.Element {
  return (
    <div className="ddag-empty">
      <div className="ddag-empty__box ddag-start">
        <strong>{nodeCount.toLocaleString()} nodes — pick a place to start.</strong>
        <p>
          {followsEditor ? "Open a model's file, search" : "Search"} for a node (<kbd>/</kbd>), or
          filter by tag above. The graph then shows that node's lineage.
        </p>
        <button type="button" className="ddag-btn" onClick={onShowAll}>
          Show all {nodeCount.toLocaleString()} nodes
        </button>
      </div>
    </div>
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
