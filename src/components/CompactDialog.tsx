import { useEffect, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";

interface CompactDialogProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
  /** Fired on a successful compact so the stream can show a fold divider (#13). */
  onCompacted: (keepTurns: number | null) => void;
}

/**
 * Compact-conversation overlay (#13). Fires `command("compact", {})` or
 * `command("compact", { keep_turns })` with an optional keep-turns input. The
 * result arrives asynchronously via the daemon's commandResults; on success the
 * overlay closes and notifies App so a "folded older turns" divider appears in
 * the stream. Failures surface inline (and via the global notice toast, since an
 * `error` frame for the rid is recorded by useDaemon).
 *
 * The keep-turns argument key (`keep_turns`) is taken from shore-tui and
 * centralized in DAEMON_COMMANDS-adjacent usage; see caveats.
 */
export function CompactDialog({
  open,
  onClose,
  commandResults,
  command,
  onCompacted,
}: CompactDialogProps) {
  const [keepTurns, setKeepTurns] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const compact = useCommandResult(commandResults);
  // The keep-turns value carried by the in-flight request, surfaced to the
  // fold divider once the command succeeds.
  const submittedKeep = useRef<number | null>(null);

  // Reset transient state and focus the input whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setKeepTurns("");
    submittedKeep.current = null;
    compact.reset();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close and signal the fold divider once the compaction succeeds. The updated
  // (folded) history arrives separately through the daemon's reducer.
  useEffect(() => {
    if (compact.result && compact.result.ok) {
      onCompacted(submittedKeep.current);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact.result]);

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

  const parsedKeep = parseKeepTurns(keepTurns);
  const invalid = keepTurns.trim().length > 0 && parsedKeep === null;

  const runCompact = () => {
    if (compact.pending || invalid) return;
    submittedKeep.current = parsedKeep;
    const args = parsedKeep === null ? {} : { keep_turns: parsedKeep };
    void compact.run(command, DAEMON_COMMANDS.compact, args);
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette compact-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Compact conversation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">⚟</span>
          <span className="inject-title">Compact conversation</span>
        </div>

        <div className="inject-body">
          <label className="compact-field">
            <span className="compact-label">Keep most recent turns</span>
            <input
              ref={inputRef}
              className="compact-input"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={keepTurns}
              placeholder="all (leave blank)"
              onChange={(e) => setKeepTurns(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runCompact();
                }
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          {compact.error ? (
            <div className="cmd-arg-hint cmd-error">Compact failed: {compact.error}</div>
          ) : compact.pending ? (
            <div className="cmd-arg-hint">Compacting…</div>
          ) : invalid ? (
            <div className="cmd-arg-hint cmd-error">
              Enter a whole number of turns to keep, or leave blank.
            </div>
          ) : (
            <div className="cmd-arg-hint">
              Summarizes older turns to free context. Leave blank to let the
              daemon decide how many recent turns to keep.
            </div>
          )}

          <div className="inject-actions">
            <button type="button" className="inject-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="inject-submit"
              onClick={runCompact}
              disabled={compact.pending || invalid}
            >
              Compact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Parses the keep-turns input. Returns a positive integer, or null when the
 * field is empty (meaning "let the daemon decide") or unparseable (invalid).
 */
function parseKeepTurns(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}
