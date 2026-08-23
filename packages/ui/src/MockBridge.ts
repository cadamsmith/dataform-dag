import type {
  HostBridge,
  HostCapabilities,
  InboundMsg,
  OutboundMsg,
  SerializedGraph,
} from "./HostBridge.js";

/**
 * An in-memory {@link HostBridge} for standalone dev + tests — no VS Code, no filesystem. Replies to
 * `ready` with a fixed graph and records outbound messages so tests can assert what the UI sent.
 */
export class MockBridge implements HostBridge {
  readonly sent: OutboundMsg[] = [];
  capabilities: HostCapabilities;
  private listeners = new Set<(msg: InboundMsg) => void>();
  constructor(
    private readonly graph: SerializedGraph,
    capabilities: Partial<HostCapabilities> = {},
  ) {
    this.capabilities = {
      openFile: false,
      compiledSql: false,
      compiledGraph: false,
      liveWatch: false,
      focusOnActive: false,
      ...capabilities,
    };
  }
  send(msg: OutboundMsg): void {
    this.sent.push(msg);
    if (msg.type === "ready") this.emit({ type: "graphUpdate", graph: this.graph });
  }
  onMessage(cb: (msg: InboundMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** Push a host → UI message (e.g. simulate an active-editor focus). */
  emit(msg: InboundMsg): void {
    for (const cb of this.listeners) cb(msg);
  }
}
