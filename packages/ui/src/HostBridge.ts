import type { CompiledSqlSection, SerializedGraph } from "@dataform-dag/core";

export type { CompiledSqlSection, SerializedGraph };

/**
 * Which tier produced the graph on screen. `parsed` is the regex parser — instant, tolerant of a
 * project that doesn't compile. `compiled` is `dataform compile --json` — exact, but needs the CLI.
 * Only a host with the `compiledGraph` capability can be asked to switch.
 */
export type GraphMode = "parsed" | "compiled";

/** Where a host's compile step is. Drives the status pill; `idle` means nothing has run yet. */
export type CompilationStatus = "idle" | "compiling" | "ready" | "error";

/** UI → host. Every payload carries a `type` discriminant; the protocol is host-independent. */
export type OutboundMsg =
  | { type: "ready" }
  | { type: "openFile"; nodeId: string; filePath: string }
  | { type: "showCompiledSql"; nodeId: string; filePath: string }
  | { type: "requestRefresh" }
  | { type: "setTagFilter"; selectedTags: string[] }
  | { type: "setGraphMode"; mode: GraphMode };

/** host → UI. */
export type InboundMsg =
  | { type: "graphUpdate"; graph: SerializedGraph }
  | { type: "focusNode"; nodeId: string }
  | { type: "compilationStatus"; status: CompilationStatus }
  | { type: "compiledSqlResult"; nodeId: string; sections: CompiledSqlSection[] }
  | { type: "compiledSqlError"; nodeId: string; message: string }
  | { type: "tagFilterState"; selectedTags: string[] }
  | { type: "graphModeState"; mode: GraphMode };

/**
 * What a host can do. The UI reads these to decide what to render — a "Go to file" button only
 * when `openFile`, a manual "Refresh" button only when `!liveWatch`. A capability the host lacks
 * means the corresponding UI is hidden, never broken.
 */
export interface HostCapabilities {
  openFile: boolean;
  /** Host can return compiled SQL for a node — needs the Dataform CLI, so never true in a browser. */
  compiledSql: boolean;
  /** Host can rebuild the graph from `dataform compile --json`, i.e. the mode toggle is meaningful. */
  compiledGraph: boolean;
  liveWatch: boolean;
  focusOnActive: boolean;
}

/** The seam. Each host implements exactly one of these; the UI never imports a host directly. */
export interface HostBridge {
  send(msg: OutboundMsg): void;
  /** Subscribe to host → UI messages. Returns an unsubscribe function. */
  onMessage(cb: (msg: InboundMsg) => void): () => void;
  capabilities: HostCapabilities;
}
