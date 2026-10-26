import type { GraphIssue } from "@dataform-dag/core";

export interface GraphDiagnosticsProps {
  issues: GraphIssue[];
  onSelectNode: (nodeId: string) => void;
}

/**
 * Collapsed issue count in the top bar, expanding to the list. Renders nothing when the graph is
 * clean, so it costs no space in the common case.
 */
export function GraphDiagnostics({
  issues,
  onSelectNode,
}: GraphDiagnosticsProps): JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <details className="ddag-diagnostics">
      <summary className="ddag-diagnostics__summary">
        <span aria-hidden="true">⚠</span> {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </summary>
      <div className="ddag-diagnostics__menu">
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
