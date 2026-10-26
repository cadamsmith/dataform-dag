import { useMemo, useState } from "react";
import { usePopover } from "./usePopover.js";

export interface TagFilterProps {
  /** How many nodes in the whole project carry each tag. Its keys are the options. */
  tagCounts: Map<string, number>;
  selectedTags: string[];
  onChange: (selectedTags: string[]) => void;
}

/**
 * Multi-select tag filter. Selection is OR — a node survives if it carries ANY selected tag — which
 * matches how Dataform's own `--tags` works and is what "show me the finance models" means.
 *
 * The popover stays open while you toggle, so picking several tags is several clicks, not several
 * round trips; a click anywhere else or Escape closes it.
 */
export function TagFilter({ tagCounts, selectedTags, onChange }: TagFilterProps): JSX.Element | null {
  const { open, setOpen, root, trigger } = usePopover();
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));
    return needle ? sorted.filter((t) => t.toLowerCase().includes(needle)) : sorted;
  }, [tagCounts, query]);

  if (tagCounts.size === 0) return null;

  const toggle = (tag: string): void => {
    const next = selected.has(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
    onChange(next);
  };

  return (
    <div className="ddag-pop" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`ddag-tool${selectedTags.length > 0 ? " is-active" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <TagGlyph />
        Tags
        {selectedTags.length > 0 && <span className="ddag-tool__count">{selectedTags.length}</span>}
      </button>
      {open && (
        <div className="ddag-pop__panel ddag-tags" role="dialog" aria-label="Filter by tag">
          <input
            type="search"
            className="ddag-field ddag-tags__search"
            placeholder="Filter tags"
            aria-label="Filter tags"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="ddag-tags__list" role="group" aria-label="Tags">
            {visible.length === 0 && <li className="ddag-pop__empty">No tag matches “{query}”</li>}
            {visible.map((tag) => {
              const on = selected.has(tag);
              return (
                <li key={tag}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className={`ddag-tags__option${on ? " is-on" : ""}`}
                    onClick={() => toggle(tag)}
                  >
                    <span className="ddag-tags__check" aria-hidden="true" />
                    <span className="ddag-tags__name">{tag}</span>
                    <span className="ddag-tags__count">{tagCounts.get(tag)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <footer className="ddag-tags__foot">
            <span>Shows nodes with any selected tag</span>
            {selectedTags.length > 0 && (
              <button type="button" className="ddag-textbtn" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}

/** The filter that's on, stated under the topbar so it can't be forgotten behind a closed menu. */
export function ActiveTags({
  selectedTags,
  onChange,
}: {
  selectedTags: string[];
  onChange: (selectedTags: string[]) => void;
}): JSX.Element | null {
  if (selectedTags.length === 0) return null;
  return (
    <div className="ddag-chips" aria-label="Active tag filter">
      <span className="ddag-chips__lead">Showing tags</span>
      {selectedTags.map((tag) => (
        <span key={tag} className="ddag-chip">
          {tag}
          <button
            type="button"
            className="ddag-chip__x"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(selectedTags.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="ddag-textbtn" onClick={() => onChange([])}>
        Clear
      </button>
    </div>
  );
}

function TagGlyph(): JSX.Element {
  return (
    <svg className="ddag-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2.5h5l6 6-5 5-6-6z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
    </svg>
  );
}
