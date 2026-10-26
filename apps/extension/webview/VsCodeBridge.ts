import type { HostBridge, HostCapabilities, InboundMsg, OutboundMsg } from "@dataform-dag/ui";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

// `acquireVsCodeApi` may be called only ONCE per webview — a second call throws — so cache it at
// module load and share the handle.
const vscode = acquireVsCodeApi();

/**
 * {@link HostBridge} over the VS Code webview channel: UI → host via `postMessage`, host → UI via the
 * window `message` event. This host can do everything, so all capabilities are on; the UI renders the
 * "Go to file" action, drops its manual Refresh (the extension live-watches), and honors focus.
 */
export class VsCodeBridge implements HostBridge {
  readonly capabilities: HostCapabilities = {
    openFile: true,
    compiledSql: true,
    liveWatch: true,
    focusOnActive: true,
  };
  private readonly listeners = new Set<(msg: InboundMsg) => void>();

  constructor() {
    window.addEventListener("message", (event: MessageEvent<InboundMsg>) => {
      for (const cb of this.listeners) cb(event.data);
    });
  }

  send(msg: OutboundMsg): void {
    vscode.postMessage(msg);
  }

  onMessage(cb: (msg: InboundMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
