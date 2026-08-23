import { useMemo, useState } from "react";

export interface NodeSearchProps {
  nodeIds: string[];
  onSelect: (nodeId: string) => void;
}

/** Cap the dropdown: a wide project has thousands of nodes and the list is a jump target, not a browser. */
const MAX_RESULTS = 12;

/** Type-to-jump over node ids. Case-insensitive substring match, alphabetical, capped. */
export function NodeSearch({ nodeIds, onSelect }: NodeSearchProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return nodeIds
      .filter((id) => id.toLowerCase().includes(needle))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_RESULTS);
  }, [nodeIds, query]);

  const select = (nodeId: string): void => {
    onSelect(nodeId);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="ddag-search">
      <input
        type="search"
        className="ddag-search__input"
        placeholder="Find a node…"
        aria-label="Find a node"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur fires before a result's click handler, so closing immediately would swallow the
        // selection; defer past the click.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          } else if (e.key === "Enter" && results[0]) {
            select(results[0]);
          }
        }}
      />
      {open && query.trim() !== "" && (
        <ul className="ddag-search__results">
          {results.length === 0 ? (
            <li className="ddag-search__empty">no match</li>
          ) : (
            results.map((id) => (
              <li key={id}>
                <button type="button" className="ddag-search__result" onClick={() => select(id)}>
                  {id}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
