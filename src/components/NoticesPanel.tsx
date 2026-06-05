import { useEffect } from "react";
import type { ProtocolNotice } from "../hooks/useDaemon.ts";
import { noticeSeverity, noticeKindLabel } from "../lib/notices.ts";

interface NoticesPanelProps {
  notices: ProtocolNotice[];
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer listing recent notices, newest first. The `notices` list is already
 * bounded by the daemon reducer (MAX_NOTICES), so no further capping needed.
 * Esc-to-close is scoped: it only acts (and stops propagation) while the panel
 * is open so it never collides with the global stream-cancel Esc handler.
 */
export function NoticesPanel({ notices, open, onClose }: NoticesPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const ordered = [...notices].reverse();

  return (
    <div className="notices-overlay" onClick={onClose}>
      <aside
        className="notices-panel"
        role="dialog"
        aria-label="Recent notices"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notices-panel-head">
          <span className="notices-panel-title">Notices</span>
          <button
            type="button"
            className="notice-dismiss"
            aria-label="Close notices"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {ordered.length === 0 ? (
          <p className="notices-empty">No notices yet.</p>
        ) : (
          <ul className="notices-list">
            {ordered.map((notice) => {
              const severity = noticeSeverity(notice.kind);
              return (
                <li key={notice.id} className={`notice-item notice-${severity}`}>
                  <div className="notice-item-head">
                    <span className="notice-kind">{noticeKindLabel(notice.kind)}</span>
                    <time className="notice-time" dateTime={notice.createdAt}>
                      {formatTime(notice.createdAt)}
                    </time>
                  </div>
                  <div className="notice-message">{notice.message}</div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
