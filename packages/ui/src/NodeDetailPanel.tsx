import { useEffect, useState } from "react";
import type { CompiledSqlSection, DataformNode, NodeType } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import { copyText } from "./clipboard.js";
import { TypeIcon, type IconKind } from "./TypeIcon.js";
import { folderPathOf, isFolderId } from "./collapseFolders.js";

export interface NodeDetailPanelProps {
  node: DataformNode;
  upstream: string[];
  downstream: string[];
  /** Resolves a neighbor's type so its row carries the same glyph and color as on the canvas. */
  typeOf?: (nodeId: string) => NodeType | undefined;
  /** Present only when the host advertises `openFile`; rendering is gated on it. */
  onOpenFile?: (node: DataformNode) => void;
  /** Present only when the host advertises `compiledSql`. */
  onShowCompiledSql?: (node: DataformNode) => void;
  /** Sections for THIS node, or null when none have been fetched (the caller matches on nodeId). */
  compiledSql?: CompiledSqlSection[] | null;
  compiledSqlError?: string | null;
  onSelect: (nodeId: string) => void;
  onClose?: () => void;
  /** Enter focus mode on this node; absent when it is already the focus. */
  onFocus?: () => void;
  /** The expanded folder this node is drawn in, to fold it back up; absent when not grouping. */
  folder?: { path: string; collapse: () => void };
}

/** Type, tags, description, direct upstream/downstream, and capability-gated file/SQL actions. */
export function NodeDetailPanel({
  node,
  upstream,
  downstream,
  typeOf,
  onOpenFile,
  onShowCompiledSql,
  compiledSql = null,
  compiledSqlError = null,
  onSelect,
  onClose,
  onFocus,
  folder,
}: NodeDetailPanelProps): JSX.Element {
  return (
    <aside className="ddag-detail" style={{ ["--type" as string]: NODE_COLORS[node.type] }}>
      <DetailHead type={node.type} kicker={node.type} title={node.id} onClose={onClose} />
      <p className="ddag-detail__file" title={node.filePath}>
        {fileName(node.filePath)}
      </p>
      {node.tags.length > 0 && <TagList tags={node.tags} />}
      {node.description && <p className="ddag-detail__desc">{node.description}</p>}
      {(onOpenFile || onShowCompiledSql || onFocus) && (
        <div className="ddag-detail__actions">
          {onOpenFile && (
            <button type="button" className="ddag-btn ddag-btn--primary" onClick={() => onOpenFile(node)}>
              Go to file
            </button>
          )}
          {onShowCompiledSql && (
            <button type="button" className="ddag-btn" onClick={() => onShowCompiledSql(node)}>
              Compiled SQL
            </button>
          )}
          {onFocus && <FocusButton onClick={onFocus} />}
        </div>
      )}
      {folder && (
        <p className="ddag-detail__file">
          in {folder.path}/{" "}
          <button type="button" className="ddag-textbtn" onClick={folder.collapse}>
            Collapse folder
          </button>
        </p>
      )}
      {compiledSqlError && <p className="ddag-detail__error">{compiledSqlError}</p>}
      {compiledSql && <CompiledSql sections={compiledSql} />}
      <NeighborList title="Depends on" ids={upstream} typeOf={typeOf} onSelect={onSelect} />
      <NeighborList title="Used by" ids={downstream} typeOf={typeOf} onSelect={onSelect} />
    </aside>
  );
}

export function DetailHead({
  type,
  kicker,
  title,
  onClose,
}: {
  type: IconKind;
  kicker: string;
  title: string;
  onClose?: () => void;
}): JSX.Element {
  return (
    <header className="ddag-detail__head">
      <span className="ddag-detail__glyph">
        <TypeIcon type={type} />
      </span>
      <div className="ddag-detail__heading">
        <span className="ddag-detail__kicker">{kicker}</span>
        <h2 className="ddag-detail__title">{title}</h2>
      </div>
      {onClose && (
        <button type="button" className="ddag-iconbtn" aria-label="Close details" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </header>
  );
}

/** Enter focus mode: show only this node's upstream and downstream. */
export function FocusButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="ddag-btn ddag-btn--icon"
      onClick={onClick}
      title="Show only this node's upstream and downstream (or double-click it)"
    >
      <svg className="ddag-glyph" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </svg>
      Focus
    </button>
  );
}

export function TagList({ tags }: { tags: string[] }): JSX.Element {
  return (
    <ul className="ddag-taglist" aria-label="Tags">
      {tags.map((t) => (
        <li key={t} className="ddag-tag">
          {t}
        </li>
      ))}
    </ul>
  );
}

export function CompiledSql({ sections }: { sections: CompiledSqlSection[] }): JSX.Element {
  if (sections.length === 0) {
    return <p className="ddag-neighbors__empty">This action compiles to no SQL.</p>;
  }
  return (
    <section className="ddag-sql">
      {sections.map((section, i) => (
        <div key={`${section.label}-${i}`} className="ddag-sql__section">
          <h3 className="ddag-section-title">{section.label}</h3>
          {/* The button sits on this wrapper, not in the <pre>, so it stays put while the SQL scrolls. */}
          <div className="ddag-sql__block">
            <pre className="ddag-sql__code">
              <code>{section.sql}</code>
            </pre>
            <CopyButton text={section.sql} what={section.label} />
          </div>
        </div>
      ))}
    </section>
  );
}

/** Copies `text`, then shows a check for a moment so the click visibly did something. */
function CopyButton({ text, what }: { text: string; what: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async (): Promise<void> => {
    await copyText(text);
    setCopied(true);
  };
  return (
    <button
      type="button"
      className={`ddag-sql__copy${copied ? " is-copied" : ""}`}
      aria-label={copied ? "Copied" : `Copy ${what}`}
      title={copied ? "Copied" : "Copy SQL"}
      onClick={() => void copy()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {copied ? (
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </>
        )}
      </svg>
    </button>
  );
}

export function NeighborList({
  title,
  ids,
  typeOf,
  onSelect,
}: {
  title: string;
  ids: string[];
  typeOf?: (nodeId: string) => NodeType | undefined;
  onSelect: (nodeId: string) => void;
}): JSX.Element {
  return (
    <section className="ddag-neighbors">
      <h3 className="ddag-section-title">
        {title} <span className="ddag-section-title__count">{ids.length}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="ddag-neighbors__empty">Nothing</p>
      ) : (
        <ul className="ddag-neighbors__list">
          {ids.map((id) => {
            const type = typeOf?.(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="ddag-neighbor"
                  style={type ? { ["--type" as string]: NODE_COLORS[type] } : undefined}
                  onClick={() => onSelect(id)}
                >
                  {isFolderId(id) ? <TypeIcon type="folder" /> : type && <TypeIcon type={type} />}
                  <span className="ddag-neighbor__name">
                    {isFolderId(id) ? `${folderPathOf(id)}/` : id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}
