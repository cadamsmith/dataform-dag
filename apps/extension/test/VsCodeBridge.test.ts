// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

// VsCodeBridge caches acquireVsCodeApi() at module load, so stub it before importing the module.
const posted: unknown[] = [];
beforeAll(() => {
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (msg: unknown) => posted.push(msg),
  });
});

describe("VsCodeBridge", () => {
  it("posts outbound messages to the host", async () => {
    const { VsCodeBridge } = await import("../webview/VsCodeBridge.js");
    new VsCodeBridge().send({ type: "openFile", nodeId: "n", filePath: "/x.sqlx" });
    expect(posted).toContainEqual({ type: "openFile", nodeId: "n", filePath: "/x.sqlx" });
  });

  it("dispatches inbound window messages to subscribers, and unsubscribes", async () => {
    const { VsCodeBridge } = await import("../webview/VsCodeBridge.js");
    const bridge = new VsCodeBridge();
    const seen: unknown[] = [];
    const off = bridge.onMessage((m) => seen.push(m));

    window.dispatchEvent(new MessageEvent("message", { data: { type: "focusNode", nodeId: "a" } }));
    off();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "focusNode", nodeId: "b" } }));

    expect(seen).toEqual([{ type: "focusNode", nodeId: "a" }]);
  });

  it("advertises full host capabilities", async () => {
    const { VsCodeBridge } = await import("../webview/VsCodeBridge.js");
    expect(new VsCodeBridge().capabilities).toEqual({
      openFile: true,
      compiledSql: true,
      liveWatch: true,
      focusOnActive: true,
    });
  });
});
