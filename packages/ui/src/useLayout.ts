import { useEffect, useState } from "react";
import { layoutGraph, type FlowGraph, type UiGraph } from "./graphToFlow.js";
import { layoutGraphElk } from "./elkLayout.js";

/**
 * Run ELK layout for the graph (async), returning the positioned {@link FlowGraph} or null while it
 * computes. Falls back to the synchronous dagre layout if ELK throws, so the canvas always renders.
 * A stale result from a superseded graph is discarded via the cancel flag.
 */
export function useLayout(graph: UiGraph | null): FlowGraph | null {
  const [flow, setFlow] = useState<FlowGraph | null>(null);
  useEffect(() => {
    if (!graph) {
      setFlow(null);
      return;
    }
    let cancelled = false;
    layoutGraphElk(graph)
      .then((f) => !cancelled && setFlow(f))
      .catch(() => !cancelled && setFlow(layoutGraph(graph)));
    return () => {
      cancelled = true;
    };
  }, [graph]);
  return flow;
}
