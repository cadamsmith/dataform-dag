import type { NodeType } from "@dataform-dag/core";

/**
 * One small glyph per node type, drawn in `currentColor`. They echo the codicons the activity-bar
 * tree uses for the same types (database, table, eye, diff-added, check, gear), so a type looks the
 * same in the sidebar and on the canvas.
 */
const GLYPHS: Record<NodeType, JSX.Element> = {
  source: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  table: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M2.5 9.75h11M6.5 6.5V13" />
    </>
  ),
  view: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  incremental: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M8 5.5v5M5.5 8h5" />
    </>
  ),
  assertion: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.5 8.2 7.2 9.9 10.6 6.3" />
    </>
  ),
  operations: (
    <>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
    </>
  ),
};

export function TypeIcon({ type, className }: { type: NodeType; className?: string }): JSX.Element {
  return (
    <svg
      className={className ?? "ddag-typeicon"}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[type]}
    </svg>
  );
}
