import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sigil } from "./Sigil.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import "../styles/window-controls.css";

interface TitlebarProps {
  /** Unread notice count, shown as a badge on the bell. */
  notices: number;
  /** Opens the NoticesPanel (the bell's only job). */
  onOpenNotices: () => void;
}

// ResizeDirection is a string-union type in the Tauri API; mirror it so the
// handle table is type-checked against startResizeDragging.
type ResizeDir = Parameters<
  ReturnType<typeof getCurrentWindow>["startResizeDragging"]
>[0];

// The eight invisible resize handles a borderless Wayland window needs: native
// edge-resize is gone, so each handle starts a Tauri resize-drag in its
// compass direction.
const RESIZE_HANDLES: { cls: string; dir: ResizeDir }[] = [
  { cls: "n", dir: "North" },
  { cls: "s", dir: "South" },
  { cls: "e", dir: "East" },
  { cls: "w", dir: "West" },
  { cls: "ne", dir: "NorthEast" },
  { cls: "nw", dir: "NorthWest" },
  { cls: "se", dir: "SouthEast" },
  { cls: "sw", dir: "SouthWest" },
];

/**
 * Custom, theme-aware titlebar replacing GTK's client-side decoration (#48).
 * One integrated bar: brand on the left, notices bell + view-settings gear +
 * window controls on the right. Drag-to-move and double-click-to-maximize are
 * delegated to Tauri via `data-tauri-drag-region`; interactive children omit
 * the attribute so their clicks register.
 */
export function Titlebar({ notices, onOpenNotices }: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  // Track the maximized state so the maximize/restore glyph stays in sync with
  // the window — both on mount and across user/WM-driven resizes.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void win.isMaximized().then((m) => {
      if (!cancelled) setMaximized(m);
    });
    void win
      .onResized(() => {
        void win.isMaximized().then((m) => {
          if (!cancelled) setMaximized(m);
        });
      })
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <>
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar-brand" data-tauri-drag-region>
          <Sigil />
          <span className="titlebar-title">Shore</span>
        </div>

        <div className="titlebar-spacer" data-tauri-drag-region />

        <button
          type="button"
          className="notices-trigger"
          aria-label="Open notices"
          onClick={onOpenNotices}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {notices > 0 && (
            <span className="notices-count" aria-hidden>
              {notices}
            </span>
          )}
        </button>

        <SettingsMenu />

        <div className="titlebar-divider" aria-hidden />

        <div className="win-controls">
          <button
            type="button"
            className="win-btn"
            aria-label="Minimize"
            onClick={() => void win.minimize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn"
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => void win.toggleMaximize()}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path
                  d="M2.5 2.5h5v5h-5z M3.5 2.5V1.5h5v5H7.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="win-btn close"
            aria-label="Close"
            onClick={() => void win.close()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M0 0l10 10M10 0L0 10"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
        </div>
      </div>

      {RESIZE_HANDLES.map(({ cls, dir }) => (
        <div
          key={cls}
          className={`titlebar-resize ${cls}`}
          onMouseDown={(e) => {
            // Only the primary button starts a resize-drag.
            if (e.button !== 0) return;
            void getCurrentWindow().startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
