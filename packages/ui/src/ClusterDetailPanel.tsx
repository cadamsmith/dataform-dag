import type { CompiledSqlSection, DataformNode } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import { CompiledSql, NeighborList } from "./NodeDetailPanel.js";

export interface ClusterDetailPanelProps {
  /** The assertions this cluster stands for, in display order. */
  members: DataformNode[];
  upstream: string[];
  downstream: string[];
  /** A member to call out — set when the selection arrived from search, a diagnostic, or the host. */
  highlightedId?: string | null;
  onSelect: (nodeId: string) => void;
  /** Present only when the host advertises `openFile`; rendering is gated on it. */
  onOpenFile?: (node: DataformNode) => void;
  /** Present only when the host advertises `compiledSql`. */
  onShowCompiledSql?: (node: DataformNode) => void;
  /** Whatever SQL the host last returned; rendered under the member that asked for it. */
  compiledSql?: { nodeId: string; sections: CompiledSqlSection[] } | null;
  compiledSqlError?: { nodeId: string; message: string } | null;
}

/**
 * The view behind a collapsed group: the canvas shows "N assertions", this lists which ones.
 *
 * Every member keeps its own file and compiled SQL actions, so collapsing costs nothing in reach —
 * it only moves the enumeration off the canvas, where N leaf nodes per model is what makes a large
 * project unreadable.
 */
export function ClusterDetailPanel({
  members,
  upstream,
  downstream,
  highlightedId = null,
  onSelect,
  onOpenFile,
  onShowCompiledSql,
  compiledSql = null,
  compiledSqlError = null,
}: ClusterDetailPanelProps): JSX.Element {
  return (
    <aside className="ddag-detail">
      <header className="ddag-detail__head">
        <span className="ddag-badge" style={{ background: NODE_COLORS.assertion }}>
          assertion
        </span>
        <h2 className="ddag-detail__title">{members.length} assertions</h2>
      </header>
      <p className="ddag-detail__desc">
        Collapsed because they share the same dependencies. Expand any one for its file or SQL.
      </p>
      <NeighborList title="Upstream (depends on)" ids={upstream} onSelect={onSelect} />
      <NeighborList title="Downstream (dependents)" ids={downstream} onSelect={onSelect} />
      <section className="ddag-members">
        <h3 className="ddag-neighbors__title">
          Assertions <span className="ddag-count">{members.length}</span>
        </h3>
        <ul className="ddag-members__list">
          {members.map((member) => (
            <li
              key={member.id}
              // aria-current marks the member the user actually asked for when a search hit or a
              // host focus resolved to this cluster.
              aria-current={member.id === highlightedId ? "true" : undefined}
              className={`ddag-members__item${
                member.id === highlightedId ? " is-highlighted" : ""
              }`}
            >
              <span className="ddag-members__name">{member.id}</span>
              {member.tags.length > 0 && (
                <span className="ddag-members__tags">
                  {member.tags.map((tag) => (
                    <span key={tag} className="ddag-tag">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
              {member.description && <p className="ddag-members__desc">{member.description}</p>}
              <span className="ddag-members__actions">
                {onOpenFile && (
                  <button type="button" className="ddag-btn" onClick={() => onOpenFile(member)}>
                    Go to file
                  </button>
                )}
                {onShowCompiledSql && (
                  <button
                    type="button"
                    className="ddag-btn"
                    onClick={() => onShowCompiledSql(member)}
                  >
                    Compiled SQL
                  </button>
                )}
              </span>
              {compiledSqlError?.nodeId === member.id && (
                <p className="ddag-detail__error">{compiledSqlError.message}</p>
              )}
              {compiledSql?.nodeId === member.id && <CompiledSql sections={compiledSql.sections} />}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
