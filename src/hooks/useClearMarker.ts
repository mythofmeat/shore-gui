import { useCallback, useEffect, useState } from "react";

/**
 * Local-only "clear system entries" marker (issue #16).
 *
 * Persists a single ISO timestamp in localStorage. System-role messages with a
 * timestamp at or before the marker are hidden from the rendered conversation
 * (see App.tsx). This is purely a view affordance — no daemon involvement, and
 * the underlying history is untouched, so the action is fully reversible via
 * `clear()` (the Undo path).
 *
 * Reuses the same-tab notification pattern from useViewSettings: writes fire a
 * synthetic "shore-gui:view-settings" event (StorageEvent only reaches other
 * tabs) so any mounted reader refreshes immediately.
 */

const PREFIX = "shore-gui:";
const STORAGE_KEY = "clear_system_before";
const EVENT = "shore-gui:view-settings";

function readMarker(): string | null {
  try {
    const raw = localStorage.getItem(PREFIX + STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeMarker(value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(PREFIX + STORAGE_KEY);
    } else {
      localStorage.setItem(PREFIX + STORAGE_KEY, value);
    }
  } catch {
    // Ignore storage failures (private mode, quota); still notify in-memory.
  }
  window.dispatchEvent(new Event(EVENT));
}

export interface ClearMarkerHandle {
  /** ISO timestamp of the current marker, or null when nothing is cleared. */
  marker: string | null;
  /** Hide system entries at/before `at` (defaults to now). */
  clearSystemBefore: (at?: Date) => void;
  /** Undo: reveal previously-cleared system entries. */
  undo: () => void;
}

export function useClearMarker(): ClearMarkerHandle {
  const [marker, setMarker] = useState<string | null>(readMarker);

  useEffect(() => {
    const refresh = () => setMarker(readMarker());
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, refresh);
    };
  }, []);

  const clearSystemBefore = useCallback((at?: Date) => {
    writeMarker((at ?? new Date()).toISOString());
  }, []);

  const undo = useCallback(() => {
    writeMarker(null);
  }, []);

  return { marker, clearSystemBefore, undo };
}

/**
 * True when a system message with the given timestamp should be hidden by the
 * clear marker. Non-system messages are never hidden here. A message with no
 * (or unparseable) timestamp is kept, since we can't prove it predates the
 * marker.
 */
export function isClearedSystemMessage(
  role: string,
  timestamp: string,
  marker: string | null,
): boolean {
  if (role !== "system" || !marker) return false;
  const t = new Date(timestamp).getTime();
  const m = new Date(marker).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(m)) return false;
  return t <= m;
}
