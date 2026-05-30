import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { ImageGallery } from "./ImageGallery.tsx";
import { DAEMON_COMMANDS } from "../lib/commands.ts";
import type { ImageRef } from "../lib/messages.ts";

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
 * Alt picker overlay (#10). Fires `command("list_alternatives", { ref? })` and
 * renders the asynchronously-arriving CommandResult.data as a list of alternate
 * replies (text + any images via ImageGallery from #5). Selecting one dispatches
 * `command("alt", { index })`; the conversation updates via the daemon's history
 * frame handled in useDaemon. Failures surface inline (and via the global notice
 * toast, since an `error` frame for the rid is recorded by useDaemon).
 */
export function AltPicker({
  open,
  onClose,
  messageRef,
  commandResults,
  command,
}: AltPickerProps) {
  const [cursor, setCursor] = useState(0);
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

  const pick = useCallback(
    (alt: Alternate) => {
      if (action.pending) return;
      void action.run(command, DAEMON_COMMANDS.alt, { index: alt.index });
    },
    [action, command],
  );

  // Scoped keys: Esc closes; arrows move the cursor; Enter applies. Capture
  // phase + stopPropagation so Esc pre-empts the global stream-cancel handler
  // while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (alts.length === 0 ? 0 : (c + 1) % alts.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) =>
          alts.length === 0 ? 0 : (c - 1 + alts.length) % alts.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const alt = alts[cursor];
        if (alt) pick(alt);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, alts, cursor, pick]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette alt-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Alternate replies"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row alt-header">
          <span className="cmd-prompt">⇄</span>
          <span className="alt-title">Alternate replies</span>
        </div>

        <div className="alt-results">
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
            <ul className="cmd-list alt-list" role="listbox">
              {alts.map((alt, i) => (
                <li
                  key={alt.id}
                  role="option"
                  aria-selected={i === cursor}
                  className={`cmd-item alt-item${
                    i === cursor ? " cmd-item-active" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(alt)}
                  title="Click to use this reply"
                >
                  <div className="alt-item-head">
                    <span className="alt-item-index">#{alt.index + 1}</span>
                    {alt.current && (
                      <span
                        className="alt-item-current"
                        aria-label="Current reply"
                      >
                        current
                      </span>
                    )}
                  </div>
                  {alt.text ? (
                    <span className="alt-item-text">{alt.text}</span>
                  ) : (
                    <span className="alt-item-text alt-item-empty">
                      (no text)
                    </span>
                  )}
                  {alt.images.length > 0 && (
                    <ImageGallery images={alt.images} />
                  )}
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
