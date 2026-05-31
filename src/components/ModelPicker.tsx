import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/** A single model option, normalized from the tolerant command payload. */
interface ModelEntry {
  id: string;
  name: string;
  description: string | null;
  current: boolean;
}

/**
 * Model switcher overlay (#21). Fires `command("list_models", { include_hidden })`
 * (the toggle includes hidden models) and renders the asynchronously-arriving
 * CommandResult.data as a list. Selecting dispatches
 * `command("switch_model", { name })`; the Reset action dispatches
 * `command("reset_model", {})`. Both close the overlay once the result lands.
 * Failures surface inline (and via the global notice toast, since an `error`
 * frame for the rid is recorded by useDaemon).
 */
export function ModelPicker({
  open,
  onClose,
  commandResults,
  command,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The model list (request → response) and the switch/reset action share
  // separate trackers so an in-flight switch doesn't clobber the list state.
  const list = useCommandResult(commandResults);
  const action = useCommandResult(commandResults);

  // Reset transient state and focus the input whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setShowAll(false);
    list.reset();
    action.reset();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // (Re)fetch the model list whenever the overlay opens or the `all` toggle
  // changes. Resetting `action` keeps a stale switch result from auto-closing.
  useEffect(() => {
    if (!open) return;
    action.reset();
    void list.run(command, DAEMON_COMMANDS.listModels, { include_hidden: showAll });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showAll]);

  // Close once a switch/reset succeeds — the new model arrives via the daemon's
  // status/command updates handled in useDaemon.
  useEffect(() => {
    if (action.result && action.result.ok) onClose();
  }, [action.result, onClose]);

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

  const models = useMemo(
    () => (list.result ? parseModels(list.result.data) : []),
    [list.result],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    );
  }, [models, query]);

  if (!open) return null;

  const pick = (model: ModelEntry) => {
    if (action.pending) return;
    void action.run(command, DAEMON_COMMANDS.switchModel, { name: model.name });
  };

  const reset = () => {
    if (action.pending) return;
    void action.run(command, DAEMON_COMMANDS.resetModel, {});
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const count = filtered.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (count === 0 ? 0 : (c + 1) % count));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (count === 0 ? 0 : (c - 1 + count) % count));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const model = filtered[cursor];
      if (model) pick(model);
    }
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette model-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Switch model"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">◇</span>
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            value={query}
            placeholder="Switch model…"
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="model-toolbar">
          <label className="model-toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            <span>Show hidden models</span>
          </label>
          <button
            type="button"
            className="model-reset"
            onClick={reset}
            disabled={action.pending}
            title="Reset to the default model"
          >
            Reset to default
          </button>
        </div>

        {action.error ? (
          <div className="cmd-arg-hint cmd-error">Model change failed: {action.error}</div>
        ) : action.pending ? (
          <div className="cmd-arg-hint">Applying…</div>
        ) : list.error ? (
          <div className="cmd-arg-hint cmd-error">Failed to load models: {list.error}</div>
        ) : list.pending ? (
          <div className="cmd-arg-hint">Loading models…</div>
        ) : models.length === 0 ? (
          <div className="cmd-empty">No models available</div>
        ) : filtered.length === 0 ? (
          <div className="cmd-empty">No models match “{query.trim()}”</div>
        ) : (
          <ul className="cmd-list model-list" role="listbox">
            {filtered.map((model, i) => (
              <li
                key={model.id}
                role="option"
                aria-selected={i === cursor}
                className={`cmd-item model-item${i === cursor ? " cmd-item-active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(model)}
              >
                <span className="model-item-name">{model.name}</span>
                {model.description ? (
                  <span className="cmd-item-desc">{model.description}</span>
                ) : null}
                {model.current && (
                  <span className="model-item-current" aria-label="Current model">
                    current
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Normalizes the daemon's list_models payload into a flat list. The shape is
 * not verifiable in this repo, so this is tolerant: accepts an array at the top
 * level or under common keys, accepts plain strings or objects, and detects the
 * current model from a `current`/`active`/`selected` flag or a top-level
 * `current`/`selected`/`model` name.
 */
function parseModels(data: unknown): ModelEntry[] {
  const list = extractList(data);
  const currentName = currentNameFrom(data);
  const out: ModelEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const entry = toModel(list[i], i, currentName);
    if (entry && !seen.has(entry.name)) {
      seen.add(entry.name);
      out.push(entry);
    }
  }
  return out;
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of ["models", "items", "names", "available", "entries"]) {
      const v = data[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function currentNameFrom(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return firstString(data, ["current", "selected", "active", "model", "current_model"]);
}

function toModel(item: unknown, index: number, currentName: string | null): ModelEntry | null {
  if (typeof item === "string") {
    const name = item.trim();
    if (!name) return null;
    return {
      id: `model:${index}:${name}`,
      name,
      description: null,
      current: currentName != null && name === currentName,
    };
  }
  if (!isRecord(item)) return null;

  const name = firstString(item, ["name", "id", "model", "key"]);
  if (!name) return null;

  const flagged =
    boolField(item, "current") ||
    boolField(item, "active") ||
    boolField(item, "selected") ||
    boolField(item, "is_current") ||
    boolField(item, "is_default");

  return {
    id: `model:${index}:${name}`,
    name,
    description: firstString(item, ["description", "label", "provider", "family"]),
    current: flagged || (currentName != null && name === currentName),
  };
}

function boolField(item: Record<string, unknown>, key: string): boolean {
  return item[key] === true;
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
