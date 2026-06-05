import type { ViewSettingKey } from "../hooks/useViewSettings.ts";
import { popOutWindow } from "./windows.ts";

/**
 * The slash-command registry. Mirrors the shore-tui parity command set:
 * regen, edit, delete, compact, sys/inject_system, memory, model, character,
 * setting/sampler, view toggles, clear.
 *
 * DAEMON COMMAND NAMES + ARG KEYS are not compile-checkable in this repo; they
 * are taken from shore-tui and CENTRALIZED here (see DAEMON_COMMANDS) so they
 * are trivial to change once verified against a live daemon.
 */

/** Centralized daemon command names — single source of truth, easy to retune. */
export const DAEMON_COMMANDS = {
  injectSystem: "inject_system",
  compact: "compact",
  memory: "memory",
  delete: "delete",
  edit: "edit",
  listAlternatives: "list_alternatives",
  alt: "alt",
  listModels: "list_models",
  switchModel: "switch_model",
  resetModel: "reset_model",
  modelSettings: "model_settings",
  setModelSetting: "set_model_setting",
  listCharacters: "list_characters",
  switchCharacter: "switch_character",
} as const;

/**
 * Context passed to a command's `run`. Pure-dispatch commands use `command`
 * (returns a rid). Others (regen/edit/delete) are owned by their own issues and
 * may be wired later; they receive the same context.
 */
export interface CommandContext {
  /** Dispatch a daemon command; resolves to the request rid. */
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
  /** Send a plain user message. */
  send: (text: string) => Promise<void> | void;
  /** Regenerate the last assistant reply, with optional guidance (#9). */
  regen: (guidance?: string) => Promise<string> | void;
  /** Cancel an in-flight stream. */
  cancel: () => Promise<void> | void;
  /** Toggle a view setting (handled via useViewSettings.setViewSetting). */
  toggleView: (key: ViewSettingKey) => void;
  /** Current value of a view setting, for label hints. */
  viewValue: (key: ViewSettingKey) => boolean;
  /** Free-text argument captured from the palette input (after the command). */
  arg: string;
}

/**
 * A command entry. A command either:
 *  - dispatches immediately (`run`),
 *  - opens a dynamic submenu (`submenu`), resolved at open time against the
 *    daemon, or
 *  - prompts for free text first (`needsArg`), then `run` receives ctx.arg.
 */
export interface Command {
  id: string;
  label: string;
  description: string;
  /** Optional keyword aliases to widen substring/fuzzy matching. */
  keywords?: string[];
  /** If set, the palette captures a text argument before running. */
  needsArg?: { placeholder: string };
  /** Direct dispatch. Receives a fully-populated context. */
  run?: (ctx: CommandContext) => void | Promise<void>;
  /** Marks a command whose handler lives in another issue (informational). */
  deferred?: boolean;
}

/**
 * Submenu kinds are resolved dynamically (models/characters/settings are
 * fetched from the daemon at open time), so the registry only declares the
 * static leaf commands. The palette builds submenu items separately.
 */

export function buildCommands(ctx: {
  toggleView: (key: ViewSettingKey) => void;
  viewValue: (key: ViewSettingKey) => boolean;
}): Command[] {
  const viewToggle = (
    id: string,
    key: ViewSettingKey,
    label: string,
  ): Command => ({
    id,
    label,
    description: ctx.viewValue(key) ? "Currently shown — hide" : "Currently hidden — show",
    keywords: ["view", "toggle", "show", "hide"],
    run: (c) => c.toggleView(key),
  });

  return [
    {
      id: "regen",
      label: "Regenerate",
      description: "Re-roll the last assistant reply (optional guidance)",
      keywords: ["regen", "retry", "reroll"],
      needsArg: { placeholder: "Guidance (optional)…" },
      // Routes through the dedicated regen invoke (#9), not a server command.
      run: (c) => void c.regen(c.arg.trim() || undefined),
    },
    {
      id: "alternatives",
      label: "Alternatives",
      description: "Browse and switch between alternate replies",
      keywords: ["alt", "alternatives", "alternates", "variants", "branch", "swipe"],
      // Opens the dedicated alt picker overlay (#10), which lists the alternates
      // for the latest assistant turn and applies the chosen one.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-alt"));
      },
    },
    {
      id: "edit",
      label: "Edit message",
      description: "Edit a previous message (provide ref + text)",
      keywords: ["edit", "revise"],
      needsArg: { placeholder: "ref text…" },
      run: (c) => {
        // First token is the message ref; the remainder is the new content.
        // The daemon's `edit` command reads { ref, content }.
        const trimmed = c.arg.trim();
        const sep = trimmed.search(/\s/);
        if (sep < 0) return;
        const ref = trimmed.slice(0, sep);
        const content = trimmed.slice(sep + 1).trim();
        if (!ref || !content) return;
        void c.command(DAEMON_COMMANDS.edit, { ref, content });
      },
      deferred: true,
    },
    {
      id: "delete",
      label: "Delete message",
      description: "Delete a message by ref",
      keywords: ["delete", "remove", "rm"],
      needsArg: { placeholder: "ref…" },
      run: (c) => {
        const ref = c.arg.trim();
        if (!ref) return;
        // The daemon's `delete` command reads { refs } (array or string).
        void c.command(DAEMON_COMMANDS.delete, { refs: [ref] });
      },
      deferred: true,
    },
    {
      id: "compact",
      label: "Compact history",
      description: "Summarize and compact the conversation",
      keywords: ["compact", "summarize", "condense", "fold"],
      // Opens the dedicated compact overlay (#13) for the optional keep-turns
      // input instead of dispatching inline.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-compact"));
      },
    },
    {
      id: "sys",
      label: "Inject system",
      description: "Insert a system message into the conversation",
      keywords: ["sys", "system", "inject", "inject_system"],
      // Opens the dedicated inject-system overlay (#14) for multiline input
      // instead of dispatching inline, so longer instructions are editable.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-inject-system"));
      },
    },
    {
      id: "memory",
      label: "Memory",
      description: "Search stored memory",
      keywords: ["memory", "recall", "remember", "search"],
      // Opens the dedicated memory search overlay (#15) instead of dispatching
      // inline, so results are rendered and clickable to quote.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-memory"));
      },
    },
    {
      id: "model",
      label: "Switch model",
      description: "Choose a model",
      keywords: ["model", "llm", "switch"],
      // Opens the dedicated model picker overlay (#21) so the show-hidden
      // toggle, reset action, and loading state render, instead of a bare-name
      // inline submenu.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-model"));
      },
    },
    {
      id: "character",
      label: "Switch character",
      description: "Choose a character",
      keywords: ["character", "persona", "char"],
      // Opens the dedicated character picker overlay (#20) so avatars + the
      // current selection render, instead of a bare-name inline submenu.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-character"));
      },
    },
    {
      id: "setting",
      label: "Model settings",
      description: "Adjust sampler / model settings",
      keywords: ["setting", "sampler", "temperature", "config"],
      // Opens the dedicated sampler settings overlay (#22) so each key renders
      // with its value + scope source and an inline edit/reset, instead of a
      // read-only inline submenu.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-setting"));
      },
    },
    {
      id: "preferences",
      label: "Preferences",
      description: "Theme, density, font, motion, shortcuts",
      keywords: ["settings", "preferences", "prefs", "theme", "appearance", "density", "font", "light", "dark"],
      // Opens the dedicated Preferences overlay (#39) — the settings home for
      // the whole app (theming, density, font, motion, speech, privacy, hotkey).
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-preferences"));
      },
    },
    {
      id: "tokens",
      label: "Tokens & cost",
      description: "Usage and cost dashboard",
      keywords: ["tokens", "cost", "usage", "cache", "dashboard", "spend", "budget"],
      // Opens the token/cost dashboard overlay (#34): cumulative usage, cache
      // hit rate, per-turn chart, and cost when the model is priced.
      run: () => {
        window.dispatchEvent(new Event("shore-gui:open-tokens"));
      },
    },
    {
      id: "new-window",
      label: "New window",
      description: "Open another window (shared session)",
      keywords: ["window", "popout", "pop out", "pane", "split", "side by side"],
      // Pops out a second window that shares the live daemon connection (#31).
      run: () => void popOutWindow(),
    },
    viewToggle("view-timestamps", "showTimestamps", "Toggle timestamps"),
    viewToggle("view-thinking", "showThinking", "Toggle thinking"),
    viewToggle("view-tools", "showTools", "Toggle tool calls"),
    viewToggle("view-images", "showImages", "Toggle images"),
    viewToggle("view-metadata", "showMetadata", "Toggle metadata"),
    {
      id: "clear",
      label: "Clear screen",
      description: "Scroll to bottom / dismiss overlays",
      keywords: ["clear", "cls", "reset view"],
      run: () => {
        window.dispatchEvent(new Event("shore-gui:clear-view"));
      },
    },
    {
      id: "clear-system",
      label: "Clear system entries",
      description: "Hide system messages up to now (reversible)",
      keywords: ["clear", "system", "hide", "dismiss", "sys"],
      run: () => {
        window.dispatchEvent(new Event("shore-gui:clear-system"));
      },
    },
  ];
}

/**
 * Command ids that open a dynamic, daemon-sourced submenu. There are currently
 * none: character switching opens the dedicated CharacterPicker overlay (#20)
 * via `shore-gui:open-character`; model switching opens the ModelPicker overlay
 * (#21) via `shore-gui:open-model`; sampler/model settings open the dedicated
 * SamplerSettings overlay (#22) via `shore-gui:open-setting` so each key renders
 * with its value + scope source and an inline edit/reset, instead of a
 * read-only inline submenu.
 */
export const SUBMENU_COMMAND_IDS = {} as const;

export type SubmenuKind = keyof typeof SUBMENU_COMMAND_IDS;

export function submenuKindFor(_id: string): SubmenuKind | null {
  return null;
}

/**
 * Substring + lightweight subsequence (fuzzy) match. Returns a score: lower is
 * better, -1 means no match. Substring hits rank above scattered subsequence
 * hits; an empty query matches everything at neutral rank.
 */
export function matchScore(query: string, command: Command): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const haystacks = [command.label, command.id, ...(command.keywords ?? [])].map(
    (h) => h.toLowerCase(),
  );

  let best = -1;
  for (const h of haystacks) {
    const idx = h.indexOf(q);
    if (idx === 0) {
      best = best < 0 ? 1 : Math.min(best, 1);
    } else if (idx > 0) {
      const s = 10 + idx;
      best = best < 0 ? s : Math.min(best, s);
    } else if (isSubsequence(q, h)) {
      const s = 100;
      best = best < 0 ? s : Math.min(best, s);
    }
  }
  return best;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export function filterCommands(query: string, commands: Command[]): Command[] {
  return commands
    .map((command) => ({ command, score: matchScore(query, command) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.command);
}
