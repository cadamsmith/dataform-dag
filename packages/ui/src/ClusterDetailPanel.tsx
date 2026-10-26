import type { CompiledSqlSection, DataformNode, NodeType } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import { CompiledSql, DetailHead, FocusButton, NeighborList, TagList } from "./NodeDetailPanel.js";

export interface ClusterDetailPanelProps {
  /** The assertions this cluster stands for, in display order. */
  members: DataformNode[];
  upstream: string[];
  downstream: string[];
  typeOf?: (nodeId: string) => NodeType | undefined;
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
  onClose?: () => void;
  /** Enter focus mode on the whole group; absent when it is already the focus. */
  onFocus?: () => void;
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
  typeOf,
  highlightedId = null,
  onSelect,
  onOpenFile,
  onShowCompiledSql,
  compiledSql = null,
  compiledSqlError = null,
  onClose,
  onFocus,
}: ClusterDetailPanelProps): JSX.Element {
  return (
    <aside className="ddag-detail" style={{ ["--type" as string]: NODE_COLORS.assertion }}>
      <DetailHead
        type="assertion"
        kicker="assertion group"
        title={`${members.length} assertions`}
        onClose={onClose}
      />
      <p className="ddag-detail__desc">
        Grouped because they check the same models. Each keeps its own file and compiled SQL.
      </p>
      {onFocus && (
        <div className="ddag-detail__actions">
          <FocusButton onClick={onFocus} />
        </div>
      )}
      <NeighborList title="Depends on" ids={upstream} typeOf={typeOf} onSelect={onSelect} />
      <NeighborList title="Used by" ids={downstream} typeOf={typeOf} onSelect={onSelect} />
      <section className="ddag-members">
        <h3 className="ddag-section-title">
          Assertions <span className="ddag-section-title__count">{members.length}</span>
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
              {member.tags.length > 0 && <TagList tags={member.tags} />}
              {member.description && <p className="ddag-members__desc">{member.description}</p>}
              {(onOpenFile || onShowCompiledSql) && (
                <span className="ddag-members__actions">
                  {onOpenFile && (
                    <button type="button" className="ddag-btn ddag-btn--small" onClick={() => onOpenFile(member)}>
                      Go to file
                    </button>
                  )}
                  {onShowCompiledSql && (
                    <button
                      type="button"
                      className="ddag-btn ddag-btn--small"
                      onClick={() => onShowCompiledSql(member)}
                    >
                      Compiled SQL
                    </button>
                  )}
                </span>
              )}
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
