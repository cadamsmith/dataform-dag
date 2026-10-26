import type {
  HostBridge,
  HostCapabilities,
  InboundMsg,
  OutboundMsg,
  SerializedGraph,
} from "./HostBridge.js";

/**
 * An in-memory {@link HostBridge} for standalone dev + tests — no VS Code, no filesystem. Replies to
 * `ready` with a fixed graph (or nothing, for `null` — a host that hasn't compiled yet) and records outbound messages so tests can assert what the UI sent.
 */
export class MockBridge implements HostBridge {
  readonly sent: OutboundMsg[] = [];
  capabilities: HostCapabilities;
  private listeners = new Set<(msg: InboundMsg) => void>();
  constructor(
    private readonly graph: SerializedGraph | null,
    capabilities: Partial<HostCapabilities> = {},
  ) {
    this.capabilities = {
      openFile: false,
      compiledSql: false,
      liveWatch: false,
      focusOnActive: false,
      ...capabilities,
    };
  }
  send(msg: OutboundMsg): void {
    this.sent.push(msg);
    if (msg.type === "ready" && this.graph) this.emit({ type: "graphUpdate", graph: this.graph });
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
