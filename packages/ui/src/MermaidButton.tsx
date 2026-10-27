import { useEffect, useState } from "react";
import { copyText } from "./clipboard.js";
import { MERMAID_MAX_EDGES } from "./mermaid.js";

/**
 * Copies the view on screen as a Mermaid flowchart. The text is built on click, not per render: a
 * hover re-renders the topbar, and the export walks every node.
 */
export function MermaidButton({ build }: { build: () => { text: string; edges: number } }): JSX.Element {
  const [done, setDone] = useState<{ edges: number } | null>(null);
  const tooBig = !!done && done.edges > MERMAID_MAX_EDGES;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), tooBig ? 6000 : 1500);
    return () => clearTimeout(t);
  }, [done, tooBig]);
  const copy = async (): Promise<void> => {
    const { text, edges } = build();
    await copyText(text);
    setDone({ edges });
  };
  return (
    <button
      type="button"
      className={`ddag-tool${tooBig ? " ddag-tool--warn" : ""}`}
      onClick={() => void copy()}
      title="Copy what's on screen as a Mermaid flowchart, for Markdown on GitHub, GitLab, Notion…"
      aria-live="polite"
    >
      {!done
        ? "Copy as Mermaid"
        : tooBig
          ? `Copied — ${done.edges.toLocaleString()} edges is past Mermaid's ${MERMAID_MAX_EDGES}; narrow the view`
          : "Copied"}
    </button>
  );
}
