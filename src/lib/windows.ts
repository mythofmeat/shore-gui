import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Multi-pane / pop-out windows (#31, frontend half).
 *
 * A thin wrapper over the backend's `open_window` command, which spawns a new
 * application window that SHARES the live daemon connection. The new window
 * mounts the full React app (and therefore `useDaemon`, which auto-connects on
 * mount); the backend makes `connect` idempotent so that second connect is a
 * no-op against the existing connection rather than a tear-down. Daemon events
 * (`connection-status`, `server-message`) are emitted app-global, so every
 * window's reducer stays in sync without any extra plumbing here.
 *
 * The backend assigns a unique label when none is given, so callers may invoke
 * `popOutWindow()` repeatedly for additional panes.
 */
export async function popOutWindow(label?: string): Promise<void> {
  try {
    await invoke("open_window", { label: label ?? null });
  } catch (err) {
    // Surface to the console; opening a window is best-effort and a failure
    // (e.g. label collision) should never break the originating window.
    console.error("open_window failed", err);
  }
}

/** Label of the window this code is running in (useful for diagnostics). */
export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}

/** Whether this is the primary window (Tauri's default window label is "main"). */
export function isPrimaryWindow(): boolean {
  return currentWindowLabel() === "main";
}
