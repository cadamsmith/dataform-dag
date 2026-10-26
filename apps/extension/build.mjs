import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** The Node-side extension: bundled CJS, `vscode` stays external (the host provides it). */
const extension = {
  entryPoints: [join(root, "src/extension.ts")],
  outfile: join(root, "dist/extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

/**
 * The webview UI: ONE self-contained iife bundle. `splitting` stays off (the esbuild default), so any
 * dynamic `import()` in the shared UI is inlined into this single script instead of becoming a
 * separate chunk. That matters: a webview loads its script under a CSP nonce, and a separately-emitted
 * chunk would not carry that nonce and would be blocked. Inlining keeps everything in the one
 * nonce'd file. CSS imports (app.css + @xyflow styles) are
 * collected into a sibling dist/webview.css that the extension links.
 */
const webview = {
  entryPoints: [join(root, "webview/main.tsx")],
  outfile: join(root, "dist/webview.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  loader: { ".css": "css" },
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctxs = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("[dataform-dag] watching…");
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
