import type { GraphIssue } from "@dataform-dag/core";
import type { GraphMode } from "./HostBridge.js";

export interface GraphDiagnosticsProps {
  issues: GraphIssue[];
  graphMode: GraphMode;
  onSelectNode: (nodeId: string) => void;
}

/**
 * Collapsed issue count in the top bar, expanding to the list. Renders nothing when the graph is
 * clean, so it costs no space in the common case.
 */
export function GraphDiagnostics({
  issues,
  graphMode,
  onSelectNode,
}: GraphDiagnosticsProps): JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <details className="ddag-diagnostics">
      <summary className="ddag-diagnostics__summary">
        <span aria-hidden="true">⚠</span> {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </summary>
      <div className="ddag-diagnostics__menu">
        {graphMode === "parsed" && (
          // Without this the parsed tier reads as broken on a perfectly healthy project: it can't
          // follow refs that only exist after compilation, so those look unresolved.
          <p className="ddag-diagnostics__note">
            Parsed mode reads files literally. A ref produced by a JS block or an include can appear
            unresolved, and a ref inside commented-out SQL is still counted, even when the project
            compiles cleanly — switch to compiled mode to confirm.
          </p>
        )}
        <ul className="ddag-diagnostics__list">
          {issues.map((issue, i) => (
            <li key={`${issue.kind}-${issue.nodeId}-${i}`} className="ddag-diagnostics__item">
              <DiagnosticItem issue={issue} onSelectNode={onSelectNode} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function DiagnosticItem({
  issue,
  onSelectNode,
}: {
  issue: GraphIssue;
  onSelectNode: (nodeId: string) => void;
}): JSX.Element {
  const node = (
    <button type="button" className="ddag-link" onClick={() => onSelectNode(issue.nodeId)}>
      {issue.nodeId}
    </button>
  );
  if (issue.kind === "unresolved-reference") {
    return (
      <>
        <span className="ddag-diagnostics__kind">unresolved ref</span> {node} depends on{" "}
        <code className="ddag-code">{issue.reference}</code>, which is not in the graph.
      </>
    );
  }
  return (
    <>
      <span className="ddag-diagnostics__kind">duplicate id</span> {node} is declared by{" "}
      {issue.filePaths.length} files; only one is reachable.
      <ul className="ddag-diagnostics__files">
        {issue.filePaths.map((filePath) => (
          <li key={filePath}>
            <code className="ddag-code">{filePath}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
