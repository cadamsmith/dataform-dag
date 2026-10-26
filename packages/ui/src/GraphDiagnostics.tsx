import type { GraphIssue } from "@dataform-dag/core";
import { usePopover } from "./usePopover.js";

export interface GraphDiagnosticsProps {
  issues: GraphIssue[];
  onSelectNode: (nodeId: string) => void;
}

/**
 * Issue count in the top bar, opening to the list. Renders nothing when the graph is clean, so it
 * costs no space in the common case.
 */
export function GraphDiagnostics({
  issues,
  onSelectNode,
}: GraphDiagnosticsProps): JSX.Element | null {
  const { open, setOpen, root, trigger } = usePopover();
  if (issues.length === 0) return null;
  return (
    <div className="ddag-pop" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="ddag-tool ddag-tool--warn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </button>
      {open && (
        <div className="ddag-pop__panel ddag-issues" role="dialog" aria-label="Graph issues">
          <ul className="ddag-issues__list">
            {issues.map((issue, i) => (
              <li key={`${issue.kind}-${issue.nodeId}-${i}`} className="ddag-issues__item">
                <DiagnosticItem
                  issue={issue}
                  onSelectNode={(id) => {
                    setOpen(false);
                    onSelectNode(id);
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DiagnosticItem({
  issue,
  onSelectNode,
}: {
  issue: GraphIssue;
  onSelectNode: (nodeId: string) => void;
}): JSX.Element {
  return (
    <>
      <p className="ddag-issues__text">
        <button type="button" className="ddag-link" onClick={() => onSelectNode(issue.nodeId)}>
          {issue.nodeId}
        </button>{" "}
        is declared by {issue.filePaths.length} files; only one is reachable.
      </p>
      <ul className="ddag-issues__files">
        {issue.filePaths.map((filePath) => (
          <li key={filePath}>
            <code className="ddag-code">{filePath}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
