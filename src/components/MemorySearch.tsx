import { useEffect, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";

interface MemorySearchProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/** A single parsed memory hit, normalized from the tolerant command payload. */
interface MemoryHit {
  id: string;
  text: string;
  meta: string | null;
}

/**
 * Memory search overlay (#15). Fires `command("memory", { query })` and renders
 * the asynchronously-arriving CommandResult.data as a list of hits. Clicking a
 * hit quotes its text into the composer (via the `shore-gui:quote` event) and
 * closes the overlay.
 */
export function MemorySearch({ open, onClose, commandResults, command }: MemorySearchProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useCommandResult(commandResults);

  // Reset transient state and focus the input whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSubmitted("");
    search.reset();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scoped Esc: close the overlay. Capture-phase + stopPropagation so it
  // pre-empts the global stream-cancel handler while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSubmitted(q);
    void search.run(command, DAEMON_COMMANDS.memory, { query: q });
  };

  const quote = (hit: MemoryHit) => {
    window.dispatchEvent(
      new CustomEvent("shore-gui:quote", { detail: { text: hit.text } }),
    );
    onClose();
  };

  const hits = search.result ? parseMemoryHits(search.result.data) : [];

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette memory-search"
        role="dialog"
        aria-modal="true"
        aria-label="Memory search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">⌕</span>
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            value={query}
            placeholder="Search memory…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="memory-results">
          {search.error ? (
            <div className="cmd-arg-hint cmd-error">Memory search failed: {search.error}</div>
          ) : search.pending ? (
            <div className="cmd-arg-hint">Searching…</div>
          ) : !submitted ? (
            <div className="cmd-empty">Type a query and press Enter</div>
          ) : hits.length === 0 ? (
            <div className="cmd-empty">No memory matches for “{submitted}”</div>
          ) : (
            <ul className="cmd-list memory-list" role="listbox">
              {hits.map((hit) => (
                <li
                  key={hit.id}
                  role="option"
                  aria-selected={false}
                  className="cmd-item memory-item"
                  title="Click to quote into the composer"
                  onClick={() => quote(hit)}
                >
                  <span className="memory-item-text">{hit.text}</span>
                  {hit.meta ? <span className="cmd-item-desc">{hit.meta}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Normalizes the daemon's memory command payload into a flat list of hits.
 * The exact shape is not verifiable in this repo, so this is tolerant: it
 * accepts an array at the top level or under common keys (results/memories/
 * matches/items), and pulls text from common fields (text/content/memory/
 * value/body) with score/source/timestamp surfaced as metadata.
 */
function parseMemoryHits(data: unknown): MemoryHit[] {
  const list = extractList(data);
  const hits: MemoryHit[] = [];
  for (let i = 0; i < list.length; i++) {
    const hit = toHit(list[i], i);
    if (hit) hits.push(hit);
  }
  return hits;
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of ["results", "memories", "matches", "items", "entries", "hits"]) {
      const v = data[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function toHit(item: unknown, index: number): MemoryHit | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { id: `mem:${index}`, text, meta: null } : null;
  }
  if (!isRecord(item)) return null;

  const text = firstString(item, ["text", "content", "memory", "value", "body", "summary"]);
  if (!text) return null;

  const id =
    firstString(item, ["id", "ref", "msg_id", "key"]) ?? `mem:${index}`;
  return { id, text, meta: metaFor(item) };
}

function metaFor(item: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const score = item.score ?? item.similarity ?? item.distance;
  if (typeof score === "number" && Number.isFinite(score)) {
    parts.push(`score ${score.toFixed(3)}`);
  }
  const source = firstString(item, ["source", "role", "origin"]);
  if (source) parts.push(source);
  const when = firstString(item, ["timestamp", "created_at", "createdAt", "date"]);
  if (when) parts.push(when);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
