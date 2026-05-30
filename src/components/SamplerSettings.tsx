import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";
import {
  SAMPLER_RESET_VALUE,
  SAMPLER_SCOPE_LABELS,
  coerceSamplerInput,
  editStringFor,
  formatSamplerValue,
  parseSamplerSnapshot,
  sliderBoundsFor,
  type SamplerField,
} from "../lib/sampler.ts";
import "../styles/sampler-sliders.css";

interface SamplerSettingsProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/**
 * Sampler settings overlay (#22). Fires `command("model_settings", {})` and
 * renders the EffectiveSamplerSnapshot — each key with its current value + scope
 * source. Per-key edit dispatches `command("set_model_setting", { key, value })`
 * with type coercion (number / bool / the reasoning_effort enum whose "off"
 * value is a literal sentinel, not null). Per-key reset dispatches the same
 * command with `value: null` (SAMPLER_RESET_VALUE).
 *
 * After any edit/reset succeeds, the snapshot is re-fetched so the displayed
 * effective values + scopes refresh. Failures surface inline (and via the global
 * notice toast, since an `error` frame for the rid is recorded by useDaemon).
 */
export function SamplerSettings({
  open,
  onClose,
  commandResults,
  command,
}: SamplerSettingsProps) {
  // The snapshot fetch and the edit/reset action use separate trackers so an
  // in-flight edit doesn't clobber the snapshot state.
  const snapshot = useCommandResult(commandResults);
  const action = useCommandResult(commandResults);
  // The key currently being edited inline, plus its draft input.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // The key whose action (edit/reset) is in flight, so we can show per-row state
  // and re-fetch the snapshot once it lands.
  const actingKey = useRef<string | null>(null);

  const fetchSnapshot = () => {
    void snapshot.run(command, DAEMON_COMMANDS.modelSettings, {});
  };

  // Fetch the snapshot whenever the overlay opens; reset transient state.
  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setDraft("");
    setLocalError(null);
    actingKey.current = null;
    action.reset();
    fetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Once an edit/reset succeeds, clear the edit row and re-fetch the snapshot so
  // effective values + scopes refresh.
  useEffect(() => {
    if (action.result && action.result.ok) {
      setEditing(null);
      setDraft("");
      actingKey.current = null;
      action.reset();
      fetchSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.result]);

  // Scoped Esc: if editing a row, cancel that; otherwise close the overlay.
  // Capture-phase + stopPropagation so it pre-empts the global stream-cancel
  // handler while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (editing) {
          setEditing(null);
          setDraft("");
          setLocalError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, editing, onClose]);

  const fields = useMemo(
    () => (snapshot.result ? parseSamplerSnapshot(snapshot.result.data) : []),
    [snapshot.result],
  );

  if (!open) return null;

  const beginEdit = (field: SamplerField) => {
    if (action.pending) return;
    setLocalError(null);
    setEditing(field.meta.key);
    setDraft(editStringFor(field));
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
    setLocalError(null);
  };

  const commitEdit = (field: SamplerField, rawValue: string | boolean) => {
    const coerced = coerceSamplerInput(field.meta, rawValue);
    if ("error" in coerced) {
      setLocalError(coerced.error);
      return;
    }
    setLocalError(null);
    actingKey.current = field.meta.key;
    void action.run(command, DAEMON_COMMANDS.setModelSetting, {
      key: field.meta.key,
      value: coerced.value,
    });
  };

  const resetKey = (field: SamplerField) => {
    if (action.pending) return;
    setLocalError(null);
    actingKey.current = field.meta.key;
    void action.run(command, DAEMON_COMMANDS.setModelSetting, {
      key: field.meta.key,
      value: SAMPLER_RESET_VALUE,
    });
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette sampler-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Sampler settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">⚙</span>
          <span className="inject-title">Sampler settings</span>
        </div>

        {snapshot.error ? (
          <div className="cmd-arg-hint cmd-error">
            Failed to load settings: {snapshot.error}
          </div>
        ) : snapshot.pending ? (
          <div className="cmd-arg-hint">Loading settings…</div>
        ) : fields.length === 0 ? (
          <div className="cmd-empty">No settings available</div>
        ) : (
          <ul className="sampler-list">
            {fields.map((field) => {
              const acting =
                action.pending && actingKey.current === field.meta.key;
              const isEditing = editing === field.meta.key;
              return (
                <li key={field.meta.key} className="sampler-row">
                  <div className="sampler-row-head">
                    <span className="sampler-key">{field.meta.label}</span>
                    {!isEditing && (
                      <span className="sampler-value">
                        {formatSamplerValue(field.value)}
                      </span>
                    )}
                    {!isEditing && (field.resolvedScope || field.scope) ? (
                      <span
                        className={`sampler-scope sampler-scope-${
                          field.resolvedScope ?? "unknown"
                        }${field.overridden ? " sampler-scope-override" : ""}`}
                        title={
                          field.scope ? `Value source: ${field.scope}` : "Value source"
                        }
                      >
                        {field.resolvedScope
                          ? SAMPLER_SCOPE_LABELS[field.resolvedScope]
                          : field.scope}
                      </span>
                    ) : null}
                    {!isEditing && (
                      <span className="sampler-row-actions">
                        <button
                          type="button"
                          className="sampler-btn"
                          onClick={() => beginEdit(field)}
                          disabled={action.pending}
                        >
                          {acting ? "…" : "edit"}
                        </button>
                        <button
                          type="button"
                          className="sampler-btn sampler-btn-reset"
                          onClick={() => resetKey(field)}
                          disabled={action.pending}
                          title="Reset to default"
                        >
                          reset
                        </button>
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <SamplerEditor
                      field={field}
                      draft={draft}
                      onDraftChange={setDraft}
                      onCommit={(v) => commitEdit(field, v)}
                      onCancel={cancelEdit}
                      pending={action.pending}
                    />
                  ) : (
                    <span className="sampler-hint">{field.meta.hint}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {localError ? (
          <div className="cmd-arg-hint cmd-error">{localError}</div>
        ) : action.error ? (
          <div className="cmd-arg-hint cmd-error">
            Update failed: {action.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SamplerEditorProps {
  field: SamplerField;
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: (value: string | boolean) => void;
  onCancel: () => void;
  pending: boolean;
}

/** The inline editor for a single field, rendered per `meta.kind`. */
function SamplerEditor({
  field,
  draft,
  onDraftChange,
  onCommit,
  onCancel,
  pending,
}: SamplerEditorProps) {
  const { meta } = field;

  if (meta.kind === "bool") {
    const on = draft === "true";
    return (
      <div className="sampler-editor">
        <label className="model-toggle">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onDraftChange(e.target.checked ? "true" : "false")}
          />
          <span>{on ? "on" : "off"}</span>
        </label>
        <div className="sampler-editor-actions">
          <button
            type="button"
            className="sampler-btn"
            onClick={() => onCommit(on)}
            disabled={pending}
          >
            save
          </button>
          <button type="button" className="sampler-btn" onClick={onCancel}>
            cancel
          </button>
        </div>
      </div>
    );
  }

  if (meta.kind === "enum") {
    return (
      <div className="sampler-editor">
        <select
          className="sampler-select"
          value={draft}
          autoFocus
          onChange={(e) => onDraftChange(e.target.value)}
        >
          {(meta.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <div className="sampler-editor-actions">
          <button
            type="button"
            className="sampler-btn"
            onClick={() => onCommit(draft)}
            disabled={pending}
          >
            save
          </button>
          <button type="button" className="sampler-btn" onClick={onCancel}>
            cancel
          </button>
        </div>
      </div>
    );
  }

  // number — a continuous slider paired with a precise numeric spinner. The
  // slider track uses sane fallback bounds (sliderBoundsFor) where meta leaves
  // a bound open; the spinner still honors meta's looser bounds during commit.
  const bounds = sliderBoundsFor(meta);
  const sliderValue = Number.isFinite(Number(draft)) ? Number(draft) : bounds.min;
  return (
    <div className="sampler-editor sampler-editor-number">
      <div className="sampler-slider-row">
        <input
          type="range"
          className="sampler-slider"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={Math.min(bounds.max, Math.max(bounds.min, sliderValue))}
          onChange={(e) => onDraftChange(e.target.value)}
          aria-label={`${meta.label} slider`}
        />
        <input
          className="sampler-input"
          type="number"
          inputMode="decimal"
          value={draft}
          autoFocus
          min={meta.min}
          max={meta.max}
          step={meta.step}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(draft);
            }
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="sampler-editor-actions">
        <button
          type="button"
          className="sampler-btn"
          onClick={() => onCommit(draft)}
          disabled={pending}
        >
          save
        </button>
        <button type="button" className="sampler-btn" onClick={onCancel}>
          cancel
        </button>
      </div>
    </div>
  );
}
