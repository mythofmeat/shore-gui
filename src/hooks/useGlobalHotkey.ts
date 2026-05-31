import { useEffect } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiSettings } from "./useUiSettings.ts";

/**
 * Registers a global (system-wide) shortcut that summons the main window —
 * showing, unminimizing and focusing it — even when the app is in the
 * background. The accelerator is read from useUiSettings().globalHotkey
 * (default "CmdOrCtrl+Shift+Space") and re-registered whenever it changes.
 *
 * Everything is wrapped in try/catch: the plugin may be unavailable (web
 * preview), the accelerator may be invalid, or it may collide with an OS-level
 * binding — in all those cases we no-op gracefully rather than crashing the app.
 *
 * App.tsx calls this once near the root.
 */
export function useGlobalHotkey(): void {
  const { globalHotkey } = useUiSettings();

  useEffect(() => {
    const accelerator = globalHotkey.trim();
    if (!accelerator) return;

    let disposed = false;

    const summon = async () => {
      try {
        const win = getCurrentWindow();
        // unminimize() is a no-op if the window isn't minimized; ordering it
        // before show()/setFocus() makes the window reliably come forward.
        await win.unminimize();
        await win.show();
        await win.setFocus();
      } catch {
        // Window API unavailable — nothing to summon.
      }
    };

    (async () => {
      try {
        // Clear any prior registration (ours or a stale one from HMR) so we
        // never hit the plugin's "shortcut already registered" error.
        await unregisterAll();
        if (disposed) return;
        await register(accelerator, (event) => {
          // The handler fires on both press and release; act on press only.
          if (event.state === "Pressed") void summon();
        });
      } catch {
        // Plugin missing, invalid accelerator, or OS conflict — no-op.
      }
    })();

    return () => {
      disposed = true;
      // Tear down on unmount or before re-registering a changed accelerator.
      void unregisterAll().catch(() => {});
    };
  }, [globalHotkey]);
}
