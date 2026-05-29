import { useEffect, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";

interface InjectSystemProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/**
 * Inject-system overlay (#14). Fires `command("inject_system", { text })` with
 * a multiline textarea. On success the daemon pushes the system entry into the
 * conversation (handled by the existing new_message reducer) and the overlay
 * closes; failures surface inline (and also via the global notice toast, since
 * an `error` frame for the rid is recorded by useDaemon).
 */
export function InjectSystem({ open, onClose, commandResults, command }: InjectSystemProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inject = useCommandResult(commandResults);

  // Reset transient state and focus the textarea whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setText("");
    inject.reset();
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close the overlay once the injection succeeds — the system entry arrives
  // through the daemon's new_message handling.
  useEffect(() => {
    if (inject.result && inject.result.ok) onClose();
  }, [inject.result, onClose]);

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

  const inject_ = () => {
    const value = text.trim();
    if (!value || inject.pending) return;
    void inject.run(command, DAEMON_COMMANDS.injectSystem, { text: value });
  };

  const canInject = text.trim().length > 0 && !inject.pending;

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette inject-system"
        role="dialog"
        aria-modal="true"
        aria-label="Inject system instruction"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">§</span>
          <span className="inject-title">Inject system instruction</span>
        </div>

        <div className="inject-body">
          <textarea
            ref={textareaRef}
            className="inject-textarea"
            value={text}
            placeholder="System instruction… (Cmd/Ctrl+Enter to inject)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                inject_();
              }
            }}
            spellCheck={false}
            rows={6}
          />

          {inject.error ? (
            <div className="cmd-arg-hint cmd-error">Inject failed: {inject.error}</div>
          ) : inject.pending ? (
            <div className="cmd-arg-hint">Injecting…</div>
          ) : (
            <div className="cmd-arg-hint">
              Inserts a system message into the conversation.
            </div>
          )}

          <div className="inject-actions">
            <button type="button" className="inject-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="inject-submit"
              onClick={inject_}
              disabled={!canInject}
            >
              Inject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
