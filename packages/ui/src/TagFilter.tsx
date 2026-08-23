import { useMemo, useState } from "react";

export interface TagFilterProps {
  /** Every tag present in the graph, deduped by the caller. */
  availableTags: string[];
  selectedTags: string[];
  onChange: (selectedTags: string[]) => void;
}

/**
 * Multi-select tag filter. Selection is OR — a node survives if it carries ANY selected tag — which
 * matches how Dataform's own `--tags` works and is what "show me the finance models" means.
 */
export function TagFilter({ availableTags, selectedTags, onChange }: TagFilterProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedTags), [selectedTags]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...availableTags].sort((a, b) => a.localeCompare(b));
    return needle ? sorted.filter((t) => t.toLowerCase().includes(needle)) : sorted;
  }, [availableTags, query]);

  if (availableTags.length === 0) return null;

  const toggle = (tag: string): void => {
    const next = selected.has(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
    onChange(next);
  };

  return (
    <details className="ddag-tagfilter">
      <summary className="ddag-tagfilter__summary">
        Tags
        {selectedTags.length > 0 && <span className="ddag-count">{selectedTags.length}</span>}
      </summary>
      <div className="ddag-tagfilter__menu">
        <input
          type="search"
          className="ddag-tagfilter__search"
          placeholder="Filter tags…"
          aria-label="Filter tags"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="ddag-tagfilter__list">
          {visible.map((tag) => (
            <li key={tag}>
              <label className="ddag-tagfilter__option">
                <input type="checkbox" checked={selected.has(tag)} onChange={() => toggle(tag)} />
                {tag}
              </label>
            </li>
          ))}
        </ul>
        {selectedTags.length > 0 && (
          <button type="button" className="ddag-btn" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
    </details>
  );
}
