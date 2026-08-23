import type { HostBridge, HostCapabilities, InboundMsg, OutboundMsg } from "@dataform-dag/ui";
import {
  buildGraph,
  parseSqlx,
  serializeGraph,
  type FileSource,
  type SerializedGraph,
} from "@dataform-dag/core/browser";

/**
 * {@link HostBridge} for the browser. A page can't open an editor, watch files, track an active
 * editor, or spawn the Dataform CLI, so every capability is off — the UI hides "Go to file" and the
 * compiled-mode controls, and shows its manual Refresh button. The graph is (re)built in-page from
 * the picked {@link FileSource} on `ready` / `requestRefresh`.
 */
export class BrowserBridge implements HostBridge {
  readonly capabilities: HostCapabilities = {
    openFile: false,
    compiledSql: false,
    compiledGraph: false,
    liveWatch: false,
    focusOnActive: false,
  };
  private readonly listeners = new Set<(msg: InboundMsg) => void>();

  constructor(private readonly source: FileSource) {}

  send(msg: OutboundMsg): void {
    if (msg.type === "ready" || msg.type === "requestRefresh") void this.rebuild();
  }

  onMessage(cb: (msg: InboundMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async rebuild(): Promise<void> {
    try {
      this.emit({ type: "graphUpdate", graph: await buildFromSource(this.source) });
    } catch (err) {
      console.error("dataform-dag: failed to build graph", err);
    }
  }

  private emit(msg: InboundMsg): void {
    for (const cb of this.listeners) cb(msg);
  }
}

async function buildFromSource(source: FileSource): Promise<SerializedGraph> {
  const paths = await source.listSqlx();
  const nodes = await Promise.all(paths.map(async (p) => parseSqlx(p, await source.read(p))));
  return serializeGraph(buildGraph(nodes));
}
