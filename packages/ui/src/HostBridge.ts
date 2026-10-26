import type { CompiledSqlSection, SerializedGraph } from "@dataform-dag/core";

export type { CompiledSqlSection, SerializedGraph };

/**
 * Where a host's compile step is. Drives the status pill; `idle` means nothing has run yet.
 * `error` is a project that failed to compile; `cli-missing` means the Dataform CLI couldn't be
 * started at all. In both cases the host keeps the last good graph on screen if it has one.
 */
export type CompilationStatus = "idle" | "compiling" | "ready" | "error" | "cli-missing";

/** UI → host. Every payload carries a `type` discriminant; the protocol is host-independent. */
export type OutboundMsg =
  | { type: "ready" }
  | { type: "openFile"; nodeId: string; filePath: string }
  | { type: "showCompiledSql"; nodeId: string; filePath: string }
  | { type: "requestRefresh" }
  | { type: "setTagFilter"; selectedTags: string[] };

/** host → UI. */
export type InboundMsg =
  | { type: "graphUpdate"; graph: SerializedGraph }
  | { type: "focusNode"; nodeId: string }
  /** Enter focus mode on a node: show only its lineage. (`focusNode` above just pans to it.) */
  | { type: "focusLineage"; nodeId: string }
  | { type: "compilationStatus"; status: CompilationStatus; message?: string }
  | { type: "compiledSqlResult"; nodeId: string; sections: CompiledSqlSection[] }
  | { type: "compiledSqlError"; nodeId: string; message: string }
  | { type: "tagFilterState"; selectedTags: string[] };

/**
 * What a host can do. The UI reads these to decide what to render — a "Go to file" button only
 * when `openFile`, a manual "Refresh" button only when `!liveWatch`. A capability the host lacks
 * means the corresponding UI is hidden, never broken.
 */
export interface HostCapabilities {
  openFile: boolean;
  /** Host can return compiled SQL for a node — needs the Dataform CLI, so never true in a browser. */
  compiledSql: boolean;
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
