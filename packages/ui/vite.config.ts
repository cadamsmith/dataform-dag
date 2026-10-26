import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone dev harness: mounts the UI against a MockBridge so packages/ui runs on its own,
// with no VS Code and no real project — spec step 2. The extension webview consumes the same src.
export default defineConfig({
  plugins: [react()],
  // elkjs is a deliberately lazy ~1.4 MB chunk (dynamic import in elkLayout.ts), off the initial
  // load path — raise the warning threshold above it so it doesn't flag on every build.
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
