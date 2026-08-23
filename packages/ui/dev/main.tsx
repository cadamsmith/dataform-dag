import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, MockBridge, type SerializedGraph } from "../src/index.js";
import sampleGraph from "./sample-graph.json";

// Standalone dev harness: the shared UI mounted against a MockBridge with a realistic 18-node graph.
// openFile off (no host to open files), liveWatch off (so the Refresh button shows).
// JSON import widens tuples/unions, so round-trip through unknown to the precise wire type.
const bridge = new MockBridge(sampleGraph as unknown as SerializedGraph, { openFile: true });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bridge={bridge} />
  </StrictMode>,
);
