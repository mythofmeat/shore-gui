import type { DisplayMessage } from "./messages.ts";

/**
 * Full-text search over the loaded conversation (#30). Deliberately simple: a
 * case-insensitive substring match against each message's text content. Returns
 * the ids of matching messages in document order, which the UI uses both to
 * drive next/prev navigation and to decide which messages to highlight.
 */
export function searchMessages(
  messages: DisplayMessage[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const m of messages) {
    if (m.content && m.content.toLowerCase().includes(q)) out.push(m.msg_id);
  }
  return out;
}

/** Count substring occurrences of `query` within `text` (case-insensitive). */
export function countOccurrences(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let i = lower.indexOf(q);
  while (i !== -1) {
    count++;
    i = lower.indexOf(q, i + q.length);
  }
  return count;
}
