import { useEffect, useState } from "react";
import type { ProtocolNotice } from "../hooks/useDaemon.ts";
import { noticeSeverity, noticeKindLabel } from "../lib/notices.ts";

const AUTO_DISMISS_MS = 7000;

interface NoticeToastProps {
  notice: ProtocolNotice | null;
}

/**
 * Non-intrusive banner pinned to the bottom of the viewport. Keyed on the
 * latest notice id so a new notice re-shows the toast (and resets the
 * auto-dismiss timer). Errors do not auto-dismiss; warnings/images do.
 */
export function NoticeToast({ notice }: NoticeToastProps) {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const activeId = notice?.id ?? null;

  useEffect(() => {
    if (!notice) return;
    const severity = noticeSeverity(notice.kind);
    if (severity === "error") return; // errors stay until dismissed
    const timer = window.setTimeout(() => setDismissedId(notice.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice || activeId === dismissedId) return null;

  const severity = noticeSeverity(notice.kind);

  return (
    <div className={`notice-toast notice-${severity}`} role="status" aria-live="polite">
      <span className="notice-kind">{noticeKindLabel(notice.kind)}</span>
      <span className="notice-message">{notice.message}</span>
      <button
        type="button"
        className="notice-dismiss"
        aria-label="Dismiss notice"
        onClick={() => setDismissedId(notice.id)}
      >
        ×
      </button>
    </div>
  );
}
