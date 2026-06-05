import { useEffect, useRef } from "react";
import "../styles/search.css";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  /** Zero-based index of the active match, or -1 when there are none. */
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/**
 * The find bar (#30) — a slim overlay pinned to the top-right of the stream.
 * Purely presentational + keyboard handling; the host owns the query, the
 * match set, and the scroll-to-active behavior.
 */
export function SearchBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const countLabel = query.trim()
    ? matchCount > 0
      ? `${activeIndex + 1}/${matchCount}`
      : "0/0"
    : "";

  return (
    <div className="search-bar" role="search">
      <svg
        className="search-bar-icon"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        value={query}
        placeholder="Find in conversation…"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="search-bar-count">{countLabel}</span>
      <button
        type="button"
        className="search-bar-btn"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        title="Previous (Shift+Enter)"
      >
        ↑
      </button>
      <button
        type="button"
        className="search-bar-btn"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        title="Next (Enter)"
      >
        ↓
      </button>
      <button
        type="button"
        className="search-bar-btn search-bar-close"
        onClick={onClose}
        aria-label="Close search"
        title="Close (Esc)"
      >
        ×
      </button>
    </div>
  );
}
