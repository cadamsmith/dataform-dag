import { useMemo } from "react";
import { layoutGraph, type FlowGraph, type UiGraph } from "./graphToFlow.js";

/**
 * Lay the graph out with dagre, or null for no graph. Synchronous: dagre lays out a whole large
 * project (~600 canvas nodes) in well under a second, where ELK took ~8s for the same graph.
 */
export function useLayout(graph: UiGraph | null): FlowGraph | null {
  return useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);
}
