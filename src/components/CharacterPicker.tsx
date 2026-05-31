import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar.tsx";
import type { CharacterInfo, CommandResult } from "../hooks/useDaemon.ts";
import { useCommandResult } from "../hooks/useCommandResult.ts";
import { DAEMON_COMMANDS } from "../lib/commands.ts";

interface CharacterPickerProps {
  open: boolean;
  onClose: () => void;
  characters: CharacterInfo[];
  selected: string | null;
  commandResults: CommandResult[];
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

/**
 * Character switcher overlay (#20). Lists status.characters with their avatars
 * and names, marks the currently selected one, and dispatches
 * command("switch_character", { name }) on pick. The selection result arrives
 * asynchronously (status update + command_output); we close on a successful
 * command result, and surface failures inline (and via the global notice toast,
 * since an `error` frame for the rid is recorded by useDaemon).
 */
export function CharacterPicker({
  open,
  onClose,
  characters,
  selected,
  commandResults,
  command,
}: CharacterPickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const switchResult = useCommandResult(commandResults);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter((c) => c.name.toLowerCase().includes(q));
  }, [characters, query]);

  // Reset transient state and focus the input whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    switchResult.reset();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close once the switch succeeds — the new character arrives via the status
  // update handled by useDaemon.
  useEffect(() => {
    if (switchResult.result && switchResult.result.ok) onClose();
  }, [switchResult.result, onClose]);

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

  const pick = (character: CharacterInfo) => {
    if (switchResult.pending) return;
    void switchResult.run(command, DAEMON_COMMANDS.switchCharacter, {
      name: character.name,
    });
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
      const character = filtered[cursor];
      if (character) pick(character);
    }
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette character-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Switch character"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">✦</span>
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            value={query}
            placeholder="Switch character…"
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {switchResult.error ? (
          <div className="cmd-arg-hint cmd-error">
            Switch failed: {switchResult.error}
          </div>
        ) : characters.length === 0 ? (
          <div className="cmd-empty">No characters available</div>
        ) : filtered.length === 0 ? (
          <div className="cmd-empty">No characters match “{query.trim()}”</div>
        ) : (
          <ul className="cmd-list character-list" role="listbox">
            {filtered.map((character, i) => {
              const isCurrent = character.name === selected;
              return (
                <li
                  key={character.name}
                  role="option"
                  aria-selected={i === cursor}
                  className={`cmd-item character-item${
                    i === cursor ? " cmd-item-active" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(character)}
                >
                  <Avatar character={character} size={32} className="character-item-avatar" />
                  <span className="character-item-name">{character.name}</span>
                  {isCurrent && (
                    <span className="character-item-current" aria-label="Current character">
                      current
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
