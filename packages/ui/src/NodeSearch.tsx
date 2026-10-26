import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DataformNode } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import { TypeIcon } from "./TypeIcon.js";

export interface NodeSearchProps {
  nodes: Pick<DataformNode, "id" | "type">[];
  onSelect: (nodeId: string) => void;
}

/** Cap the list: a wide project has thousands of nodes and this is a jump target, not a browser. */
const MAX_RESULTS = 40;

/**
 * Type-to-jump over node ids, as a combobox: arrows move, Enter jumps, Escape clears. Matches are
 * case-insensitive substrings, ranked prefix-first, then alphabetically. `/` focuses it from
 * anywhere outside a text field.
 */
export function NodeSearch({ nodes, onSelect }: NodeSearchProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    return nodes
      .map((node) => ({ node, at: node.id.toLowerCase().indexOf(needle) }))
      .filter((r) => r.at >= 0)
      .sort((a, b) => Number(a.at !== 0) - Number(b.at !== 0) || a.node.id.localeCompare(b.node.id))
      .slice(0, MAX_RESULTS);
  }, [nodes, needle]);

  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const select = (nodeId: string): void => {
    onSelect(nodeId);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  const showList = open && needle !== "";

  return (
    <div className="ddag-search">
      <svg className="ddag-search__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        className="ddag-field ddag-search__input"
        placeholder="Find a node"
        aria-label="Find a node"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur fires before a result's click; results use onMouseDown + preventDefault, so this only
        // closes for a real focus loss.
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && results.length) {
            e.preventDefault();
            setActive((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp" && results.length) {
            e.preventDefault();
            setActive((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === "Enter" && results[active]) {
            select(results[active].node.id);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
      />
      {!query && (
        <kbd className="ddag-search__kbd" aria-hidden="true">
          /
        </kbd>
      )}
      {showList && (
        <ul ref={list} id={listId} role="listbox" className="ddag-pop__panel ddag-search__results">
          {results.length === 0 ? (
            <li className="ddag-pop__empty" role="presentation">
              No node matches “{query.trim()}”
            </li>
          ) : (
            results.map(({ node, at }, i) => (
              <li
                key={node.id}
                id={`${listId}-${i}`}
                role="option"
                // The <mark> splits the name into separate text runs; state it whole.
                aria-label={`${node.id}, ${node.type}`}
                aria-selected={i === active}
                className={`ddag-search__result${i === active ? " is-active" : ""}`}
                style={{ ["--type" as string]: NODE_COLORS[node.type] }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(node.id)}
              >
                <TypeIcon type={node.type} />
                <span className="ddag-search__name">
                  {node.id.slice(0, at)}
                  <mark>{node.id.slice(at, at + needle.length)}</mark>
                  {node.id.slice(at + needle.length)}
                </span>
                <span className="ddag-search__type">{node.type}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
