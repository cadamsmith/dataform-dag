import { useEffect, useMemo, useState } from "react";
import type { DataformNode } from "@dataform-dag/core";
import type { CompilationStatus, GraphMode, HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import { NODE_COLORS, downstreamOf, indexGraph, upstreamOf } from "./graphToFlow.js";
import { allTags, filterGraphByTags } from "./filterGraph.js";
import { useLayout } from "./useLayout.js";
import { DagGraph } from "./DagGraph.js";
import { GraphDiagnostics } from "./GraphDiagnostics.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import { NodeSearch } from "./NodeSearch.js";
import { TagFilter } from "./TagFilter.js";
import "./app.css";

export interface AppProps {
  bridge: HostBridge;
}

/** Host-agnostic root. Knows nothing about which host embeds it — only {@link HostBridge}. */
export function App({ bridge }: AppProps): JSX.Element {
  const {
    graph,
    focusRequest,
    compilationStatus,
    graphMode,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
  } = useHostBridge(bridge);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
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
  const flow = useLayout(visibleGraph);
  // Index the UNFILTERED graph so the detail panel reports a node's true dependencies, and so a
  // diagnostic can link to a node the current tag filter happens to hide.
  const index = useMemo(() => (graph ? indexGraph(graph) : null), [graph]);
  const selected: DataformNode | null =
    (index && selectedId && index.byId.get(selectedId)) || null;

  const changeTags = (next: string[]): void => {
    setSelectedTags(next);
    bridge.send({ type: "setTagFilter", selectedTags: next });
  };

  return (
    <div className="ddag-app">
      <header className="ddag-topbar">
        <h1 className="ddag-topbar__title">dataform-dag</h1>
        <Legend />
        <div className="ddag-topbar__spacer" />
        {graph && (
          <NodeSearch nodeIds={graph.nodes.map((n) => n.id)} onSelect={setSelectedId} />
        )}
        <TagFilter
          availableTags={availableTags}
          selectedTags={selectedTags}
          onChange={changeTags}
        />
        {graph && (
          <GraphDiagnostics
            issues={graph.issues}
            graphMode={graphMode}
            onSelectNode={setSelectedId}
          />
        )}
        {visibleGraph && (
          <span className="ddag-topbar__count">
            {visibleGraph.nodes.length}
            {graph && visibleGraph.nodes.length !== graph.nodes.length
              ? ` / ${graph.nodes.length}`
              : ""}{" "}
            nodes
          </span>
        )}
        {capabilities.compiledGraph && (
          <ModeToggle
            mode={graphMode}
            status={compilationStatus}
            onChange={(mode) => bridge.send({ type: "setGraphMode", mode })}
          />
        )}
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
              selectedId={selectedId}
              focus={focusRequest}
              onSelectNode={setSelectedId}
            />
          ) : (
            <div className="ddag-empty">Waiting for a graph…</div>
          )}
        </main>
        {selected && index && (
          <NodeDetailPanel
            node={selected}
            upstream={upstreamOf(index, selected.id)}
            downstream={downstreamOf(index, selected.id)}
            onSelect={setSelectedId}
            onOpenFile={
              capabilities.openFile
                ? (node) => bridge.send({ type: "openFile", nodeId: node.id, filePath: node.filePath })
                : undefined
            }
            onShowCompiledSql={
              capabilities.compiledSql
                ? (node) =>
                    bridge.send({
                      type: "showCompiledSql",
                      nodeId: node.id,
                      filePath: node.filePath,
                    })
                : undefined
            }
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

const STATUS_LABEL: Record<CompilationStatus, string> = {
  idle: "",
  compiling: "compiling…",
  ready: "compiled",
  error: "compile failed",
};

function ModeToggle({
  mode,
  status,
  onChange,
}: {
  mode: GraphMode;
  status: CompilationStatus;
  onChange: (mode: GraphMode) => void;
}): JSX.Element {
  return (
    <div className="ddag-mode">
      {(["parsed", "compiled"] as GraphMode[]).map((m) => (
        <button
          key={m}
          type="button"
          className={`ddag-mode__btn${mode === m ? " ddag-mode__btn--on" : ""}`}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {m}
        </button>
      ))}
      {status !== "idle" && (
        <span className={`ddag-status ddag-status--${status}`}>{STATUS_LABEL[status]}</span>
      )}
    </div>
  );
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
