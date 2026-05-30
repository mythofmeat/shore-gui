import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { ImageGallery } from "./ImageGallery.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { DAEMON_COMMANDS } from "../lib/commands.ts";
import type { ImageRef } from "../lib/messages.ts";
import "../styles/alt-grid.css";

interface AltPickerProps {
  open: boolean;
  onClose: () => void;
  /**
   * The conversation-message ref the alternates belong to (an assistant
   * msg_id), or null to operate on the latest turn. Passed when opened from a
   * specific message's action row; null when opened from the palette. Named
   * `messageRef` (not `ref`) because `ref` is reserved by React for refs.
   */
  messageRef: string | null;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/** A single alternate reply, normalized from the tolerant command payload. */
interface Alternate {
  id: string;
  index: number;
  text: string;
  images: ImageRef[];
  current: boolean;
}

/**
 * Alt picker overlay (#10 / #25). Fires `command("list_alternatives", { ref? })`
 * and renders the asynchronously-arriving CommandResult.data as a side-by-side
 * GRID of alternate replies — each card showing the full reply (markdown via
 * MarkdownBody from #45, images via ImageGallery from #5) in a scrollable body,
 * with the current alternate badged. Selecting one (click / Enter) dispatches
 * `command("alt", { index })`; the conversation updates via the daemon's history
 * frame handled in useDaemon. Failures surface inline (and via the global notice
 * toast, since an `error` frame for the rid is recorded by useDaemon).
 *
 * Keyboard: arrows move the cursor across the grid (Left/Right step one card,
 * Up/Down jump a row), Enter applies the focused card, Esc closes.
 */
export function AltPicker({
  open,
  onClose,
  messageRef,
  commandResults,
  command,
}: AltPickerProps) {
  const [cursor, setCursor] = useState(0);
  // Number of grid columns, measured from layout so Up/Down can jump a full
  // row. Updated by the grid card whenever the track wraps (see GridMeasure).
  const [columns, setColumns] = useState(1);
  // The list (request → response) and the apply action share separate trackers
  // so an in-flight apply doesn't clobber the list state.
  const list = useCommandResult(commandResults);
  const action = useCommandResult(commandResults);

  // (Re)fetch the alternates whenever the overlay opens (for the given ref).
  useEffect(() => {
    if (!open) return;
    setCursor(0);
    action.reset();
    const args = messageRef ? { ref: messageRef } : {};
    void list.run(command, DAEMON_COMMANDS.listAlternatives, args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messageRef]);

  // Close once an apply succeeds — the revised conversation arrives via the
  // daemon's history/new_message frames handled in useDaemon.
  useEffect(() => {
    if (action.result && action.result.ok) onClose();
  }, [action.result, onClose]);

  const alts = useMemo(
    () => (list.result ? parseAlternates(list.result.data) : []),
    [list.result],
  );

  // Land the cursor on the current alternate when the list first arrives.
  useEffect(() => {
    if (alts.length === 0) return;
    const cur = alts.findIndex((a) => a.current);
    if (cur >= 0) setCursor(cur);
  }, [alts]);

  const pick = useCallback(
    (alt: Alternate) => {
      if (action.pending) return;
      void action.run(command, DAEMON_COMMANDS.alt, { index: alt.index });
    },
    [action, command],
  );

  // Scoped keys: Esc closes; arrows move the cursor through the grid; Enter
  // applies. Capture phase + stopPropagation so Esc pre-empts the global
  // stream-cancel handler while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      const n = alts.length;
      if (n === 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setCursor((c) => (c + 1) % n);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCursor((c) => (c - 1 + n) % n);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + columns, n - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - columns, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const alt = alts[cursor];
        if (alt) pick(alt);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, alts, cursor, columns, pick]);

  if (!open) return null;

  const ready =
    !action.error &&
    !action.pending &&
    !list.error &&
    !list.pending &&
    alts.length > 0;

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette alt-picker alt-picker-grid"
        role="dialog"
        aria-modal="true"
        aria-label="Alternate replies"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row alt-header">
          <span className="cmd-prompt">⇄</span>
          <span className="alt-title">Alternate replies</span>
          {alts.length > 0 && (
            <span className="alt-count" aria-hidden="true">
              {alts.length}
            </span>
          )}
        </div>

        <div className="alt-results alt-grid-results">
          {action.error ? (
            <div className="cmd-arg-hint cmd-error">
              Could not switch reply: {action.error}
            </div>
          ) : action.pending ? (
            <div className="cmd-arg-hint">Switching…</div>
          ) : list.error ? (
            <div className="cmd-arg-hint cmd-error">
              Failed to load alternatives: {list.error}
            </div>
          ) : list.pending ? (
            <div className="cmd-arg-hint">Loading alternatives…</div>
          ) : alts.length === 0 ? (
            <div className="cmd-empty">No alternate replies for this turn</div>
          ) : (
            <div className="alt-grid" role="listbox" aria-label="Alternate replies">
              {alts.map((alt, i) => (
                <AltCard
                  key={alt.id}
                  alt={alt}
                  active={i === cursor}
                  onHover={() => setCursor(i)}
                  onPick={() => pick(alt)}
                  reportColumns={i === 0 ? setColumns : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {ready && (
          <div className="alt-grid-foot" aria-hidden="true">
            ←→ move · ↑↓ row · enter use · esc close
          </div>
        )}
      </div>
    </div>
  );
}

interface AltCardProps {
  alt: Alternate;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  /**
   * When present (the first card only), reports the live column count of the
   * grid so the parent's Up/Down nav can jump a full row. Measured from the
   * card's offset row vs. its siblings via the shared grid container.
   */
  reportColumns?: (n: number) => void;
}

/** A single comparison card: badge + scrollable markdown body + images. */
function AltCard({ alt, active, onHover, onPick, reportColumns }: AltCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Keep the focused card scrolled into view as the cursor moves.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Measure the grid's column count from the first card by counting how many
  // siblings share its top offset. Runs on mount + resize; cheap and avoids
  // hard-coding the responsive breakpoints from CSS.
  useEffect(() => {
    if (!reportColumns) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const grid = el.parentElement;
      if (!grid) return;
      const cards = Array.from(grid.children) as HTMLElement[];
      if (cards.length === 0) return;
      const top = cards[0].offsetTop;
      let cols = 0;
      for (const c of cards) {
        if (c.offsetTop === top) cols++;
        else break;
      }
      reportColumns(Math.max(1, cols));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const grid = el.parentElement;
    if (grid) ro.observe(grid);
    return () => ro.disconnect();
  }, [reportColumns]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      className={`alt-card${active ? " alt-card-active" : ""}${
        alt.current ? " alt-card-current" : ""
      }`}
      onMouseEnter={onHover}
      onClick={onPick}
      title="Click to use this reply"
    >
      <div className="alt-card-head">
        <span className="alt-card-index">#{alt.index + 1}</span>
        {alt.current && (
          <span className="alt-card-current" aria-label="Current reply">
            current
          </span>
        )}
      </div>
      <div className="alt-card-body">
        {alt.text ? (
          <MarkdownBody content={alt.text} />
        ) : alt.images.length === 0 ? (
          <span className="alt-card-empty">(no text)</span>
        ) : null}
        {alt.images.length > 0 && <ImageGallery images={alt.images} />}
      </div>
    </div>
  );
}

/**
 * Normalizes the daemon's list_alternatives payload into a flat list. The shape
 * is not verifiable in this repo, so this is tolerant: it accepts an array at
 * the top level or under common keys (alternatives/alternates/alts/variants/
 * items), pulls text from common fields, collects renderable images, and detects
 * the current alternate from a flag or a top-level current/selected index.
 */
function parseAlternates(data: unknown): Alternate[] {
  const listLike = extractList(data);
  const currentIndex = currentIndexFrom(data);
  const out: Alternate[] = [];
  for (let i = 0; i < listLike.length; i++) {
    const alt = toAlternate(listLike[i], i, currentIndex);
    if (alt) out.push(alt);
  }
  return out;
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of [
      "alternatives",
      "alternates",
      "alts",
      "variants",
      "options",
      "items",
      "messages",
      "entries",
    ]) {
      const v = data[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function currentIndexFrom(data: unknown): number | null {
  if (!isRecord(data)) return null;
  for (const key of ["current", "selected", "active", "current_index", "index"]) {
    const v = data[key];
    if (typeof v === "number" && Number.isInteger(v)) return v;
  }
  return null;
}

function toAlternate(
  item: unknown,
  index: number,
  currentIndex: number | null,
): Alternate {
  if (typeof item === "string") {
    return {
      id: `alt:${index}`,
      index,
      text: item,
      images: [],
      current: currentIndex === index,
    };
  }
  if (!isRecord(item)) {
    return {
      id: `alt:${index}`,
      index,
      text: "",
      images: [],
      current: currentIndex === index,
    };
  }

  const explicitIndex = numberField(item, ["index", "idx", "position", "n"]);
  const resolvedIndex = explicitIndex ?? index;
  const text =
    firstString(item, ["text", "content", "body", "message", "reply"]) ??
    textFromBlocks(item.content_blocks) ??
    "";
  const flagged =
    boolField(item, "current") ||
    boolField(item, "active") ||
    boolField(item, "selected") ||
    boolField(item, "is_current");

  return {
    id: `alt:${resolvedIndex}:${index}`,
    index: resolvedIndex,
    text,
    images: imagesFrom(item.images),
    current: flagged || currentIndex === resolvedIndex,
  };
}

function textFromBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;
  const parts = blocks.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === "text") {
      const text = typeof block.text === "string" ? block.text : null;
      return text !== null ? [text] : [];
    }
    return [];
  });
  return parts.length > 0 ? parts.join("") : null;
}

function imagesFrom(value: unknown): ImageRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((image) => {
    if (!isRecord(image)) return [];
    const path = typeof image.path === "string" ? image.path : null;
    const data = typeof image.data === "string" ? image.data : null;
    // Only renderable refs (carrying base64 data) are useful; ImageGallery
    // skips the rest, but we still keep a path for keying when present.
    if (!data) return [];
    return [
      {
        path: path ?? "",
        caption: typeof image.caption === "string" ? image.caption : null,
        data,
      },
    ];
  });
}

function numberField(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "number" && Number.isInteger(v)) return v;
  }
  return null;
}

function boolField(item: Record<string, unknown>, key: string): boolean {
  return item[key] === true;
}

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
