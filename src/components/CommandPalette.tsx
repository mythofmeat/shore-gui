import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandResult } from "../hooks/useDaemon.ts";
import {
  buildCommands,
  filterCommands,
  type Command,
  type CommandContext,
} from "../lib/commands.ts";
import {
  setViewSetting,
  useViewSettings,
  type ViewSettingKey,
} from "../hooks/useViewSettings.ts";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
  send: (text: string) => Promise<void> | void;
  regen: (guidance?: string) => Promise<string> | void;
  cancel: () => Promise<void> | void;
}

type Mode = { kind: "list" } | { kind: "arg"; command: Command };

export function CommandPalette({
  open,
  onClose,
  command,
  send,
  regen,
  cancel,
}: CommandPaletteProps) {
  const settings = useViewSettings();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () =>
      buildCommands({
        toggleView: (key) => setViewSetting(key, !readView(settings, key)),
        viewValue: (key) => readView(settings, key),
      }),
    [settings],
  );

  const filtered = useMemo(
    () => (mode.kind === "list" ? filterCommands(query, commands) : commands),
    [mode.kind, query, commands],
  );

  // Reset transient UI state whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setMode({ kind: "list" });
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scoped Esc: close arg back to list, else close palette. Capture so
  // it pre-empts the global stream-cancel handler while the palette is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (mode.kind === "list") {
          onClose();
        } else {
          setMode({ kind: "list" });
          setQuery("");
          setCursor(0);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, mode, onClose]);

  const ctx = useMemo<Omit<CommandContext, "arg">>(
    () => ({
      command,
      send,
      regen,
      cancel,
      toggleView: (key) => setViewSetting(key, !readView(settings, key)),
      viewValue: (key) => readView(settings, key),
    }),
    [command, send, regen, cancel, settings],
  );

  if (!open) return null;

  const visibleCount = filtered.length;

  const runCommand = (cmd: Command) => {
    if (cmd.needsArg) {
      setMode({ kind: "arg", command: cmd });
      setQuery("");
      return;
    }
    void cmd.run?.({ ...ctx, arg: "" });
    onClose();
  };

  const runArg = () => {
    if (mode.kind !== "arg") return;
    void mode.command.run?.({ ...ctx, arg: query });
    onClose();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (visibleCount === 0 ? 0 : (c + 1) % visibleCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (visibleCount === 0 ? 0 : (c - 1 + visibleCount) % visibleCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode.kind === "arg") {
        runArg();
      } else {
        const cmd = filtered[cursor];
        if (cmd) runCommand(cmd);
      }
    }
    // Esc handled by the capture-phase window listener.
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          {mode.kind !== "list" && (
            <button
              type="button"
              className="cmd-back"
              aria-label="Back"
              onClick={() => {
                setMode({ kind: "list" });
                setQuery("");
                setCursor(0);
              }}
            >
              ‹
            </button>
          )}
          <span className="cmd-prompt">
            {mode.kind === "arg" ? mode.command.label : "/"}
          </span>
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            value={query}
            placeholder={
              mode.kind === "arg"
                ? mode.command.needsArg?.placeholder ?? "…"
                : "Type a command…"
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onListKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {mode.kind === "arg" ? (
          <div className="cmd-arg-hint">{mode.command.description} — Enter to run</div>
        ) : (
          <ul className="cmd-list" role="listbox">
            {filtered.length === 0 ? (
              <li className="cmd-empty">No matching commands</li>
            ) : (
              filtered.map((cmd, i) => (
                <li
                  key={cmd.id}
                  role="option"
                  aria-selected={i === cursor}
                  className={`cmd-item${i === cursor ? " cmd-item-active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => runCommand(cmd)}
                >
                  <span className="cmd-item-label">{cmd.label}</span>
                  <span className="cmd-item-desc">{cmd.description}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function readView(settings: ReturnType<typeof useViewSettings>, key: ViewSettingKey): boolean {
  return settings[key];
}
