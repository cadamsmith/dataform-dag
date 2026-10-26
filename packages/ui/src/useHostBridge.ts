import { useEffect, useState } from "react";
import type {
  CompilationStatus,
  CompiledSqlSection,
  HostBridge,
  SerializedGraph,
} from "./HostBridge.js";

export interface HostBridgeState {
  graph: SerializedGraph | null;
  /** The node the host last asked to focus (e.g. active editor changed). Cleared after consumption. */
  focusRequest: { nodeId: string; nonce: number } | null;
  /** The node the host last asked to enter focus mode on, nonce'd like `focusRequest`. */
  lineageRequest: { nodeId: string; nonce: number } | null;
  /** The host's suggested starting node, nonce'd like `focusRequest`. */
  startRequest: { nodeId: string; nonce: number } | null;
  compilationStatus: CompilationStatus;
  /** Detail for an `error` / `cli-missing` status (the compiler's message), else null. */
  compilationMessage: string | null;
  compiledSql: { nodeId: string; sections: CompiledSqlSection[] } | null;
  compiledSqlError: { nodeId: string; message: string } | null;
  /** Filter the host restored from its own storage, or null if it never sent one. */
  savedTagFilter: string[] | null;
}

/**
 * Subscribe a component to a {@link HostBridge}: sends `ready` on mount (so the host knows to push
 * the initial graph), then tracks everything the host pushes. `focusRequest` carries a nonce so a
 * repeated focus of the same node still re-fires downstream effects.
 */
export function useHostBridge(bridge: HostBridge): HostBridgeState {
  const [graph, setGraph] = useState<SerializedGraph | null>(null);
  const [focusRequest, setFocusRequest] = useState<HostBridgeState["focusRequest"]>(null);
  const [lineageRequest, setLineageRequest] = useState<HostBridgeState["lineageRequest"]>(null);
  const [startRequest, setStartRequest] = useState<HostBridgeState["startRequest"]>(null);
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("idle");
  const [compilationMessage, setCompilationMessage] = useState<string | null>(null);
  const [compiledSql, setCompiledSql] = useState<HostBridgeState["compiledSql"]>(null);
  const [compiledSqlError, setCompiledSqlError] =
    useState<HostBridgeState["compiledSqlError"]>(null);
  const [savedTagFilter, setSavedTagFilter] = useState<string[] | null>(null);
  useEffect(() => {
    let nonce = 0;
    const unsubscribe = bridge.onMessage((msg) => {
      if (msg.type === "graphUpdate") setGraph(msg.graph);
      else if (msg.type === "focusNode") setFocusRequest({ nodeId: msg.nodeId, nonce: ++nonce });
      else if (msg.type === "focusLineage")
        setLineageRequest({ nodeId: msg.nodeId, nonce: ++nonce });
      else if (msg.type === "startFrom") setStartRequest({ nodeId: msg.nodeId, nonce: ++nonce });
      else if (msg.type === "compilationStatus") {
        setCompilationStatus(msg.status);
        setCompilationMessage(msg.message ?? null);
        // A run that is starting (or was reset) invalidates whatever SQL is on screen — it was
        // produced by the previous compile and may no longer match the file.
        if (msg.status === "idle" || msg.status === "compiling") {
          setCompiledSql(null);
          setCompiledSqlError(null);
        }
      } else if (msg.type === "compiledSqlResult") {
        setCompiledSql({ nodeId: msg.nodeId, sections: msg.sections });
        setCompiledSqlError(null);
      } else if (msg.type === "compiledSqlError") {
        setCompiledSqlError({ nodeId: msg.nodeId, message: msg.message });
        setCompiledSql(null);
      } else if (msg.type === "tagFilterState") setSavedTagFilter(msg.selectedTags);
    });
    bridge.send({ type: "ready" });
    return unsubscribe;
  }, [bridge]);
  return {
    graph,
    focusRequest,
    lineageRequest,
    startRequest,
    compilationStatus,
    compilationMessage,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
  };
}
