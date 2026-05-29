import type { ProtocolNotice } from "../hooks/useDaemon.ts";

export type NoticeSeverity = "error" | "warning" | "image";

/** Collapse the protocol notice kinds into the three display severities. */
export function noticeSeverity(kind: ProtocolNotice["kind"]): NoticeSeverity {
  if (kind === "error") return "error";
  if (kind === "image") return "image";
  return "warning";
}

/** Short uppercase label shown alongside the message. */
export function noticeKindLabel(kind: ProtocolNotice["kind"]): string {
  switch (kind) {
    case "error":
      return "Error";
    case "image":
      return "Image";
    case "cache_warning":
      return "Cache";
    case "provider_fallback_warning":
      return "Fallback";
    case "usage_warning":
      return "Usage";
  }
}
