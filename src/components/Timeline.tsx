import { useMemo, useState } from "react";
import type { DisplayMessage } from "../lib/messages.ts";
import { literaryDuration, formatTimestamp } from "../lib/messages.ts";
import "../styles/timeline.css";

/**
 * A compacted/folded span of the conversation, given as an inclusive range of
 * message ids. The integrator can derive these from the existing compactFold
 * state (e.g. everything older than the kept-turns boundary).
 */
export interface CompactedRange {
  /** Inclusive first message id of the folded span. */
  fromMsgId: string;
  /** Inclusive last message id of the folded span. */
  toMsgId: string;
}

interface TimelineProps {
  messages: DisplayMessage[];
  /** Scroll the given message into view (integrator wires this to the scroller). */
  onJumpTo: (msgId: string) => void;
  /** Optional folded spans, drawn as a distinct seam on the rail. */
  compactedRanges?: CompactedRange[];
  /** The topmost visible message id, reflected as the position thumb. */
  currentMsgId?: string | null;
}

// Vertical resolution of the rail in buckets. Messages are binned by *position*
// (not wall-clock time) so the rail maps cleanly onto the linear stream the
// scroller shows; density still reads as heat because turns cluster unevenly.
const BUCKETS = 64;
// A gap is only worth marking when literaryDuration says so (>= an hour).

interface Bucket {
  /** Fraction of the densest bucket, 0..1, for heat opacity. */
  heat: number;
  /** The message to jump to when this band is clicked (first in the bucket). */
  anchorId: string | null;
  /** Set when this bucket falls inside a folded span. */
  folded: boolean;
}

interface GapMark {
  /** Vertical position, 0..1 down the rail. */
  at: number;
  label: string;
}

interface TimelineModel {
  buckets: Bucket[];
  gaps: GapMark[];
  /** Position of the current thumb, 0..1, or null when unknown. */
  thumbAt: number | null;
  /** Span label for the whole conversation, e.g. "09:14 — 18:30". */
  spanLabel: string;
}

/**
 * #29 — a slim conversation scrubber that lives in the stream's right margin.
 * Presentational: it owns no daemon state, only deriving a density model from
 * `messages` and reporting clicks back through `onJumpTo`. The rail is a thin
 * strip at rest and reveals its labels/heat on hover, so it reads as a literary
 * margin rather than a scrollbar gadget.
 */
export function Timeline({
  messages,
  onJumpTo,
  compactedRanges,
  currentMsgId,
}: TimelineProps) {
  const [hover, setHover] = useState(false);

  const model = useMemo<TimelineModel>(
    () => buildModel(messages, compactedRanges, currentMsgId ?? null),
    [messages, compactedRanges, currentMsgId],
  );

  // Nothing to scrub through until the conversation has some shape.
  if (messages.length < 3) return null;

  return (
    <nav
      className={`timeline${hover ? " timeline-open" : ""}`}
      aria-label="Conversation timeline"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="timeline-rail">
        {model.buckets.map((bucket, i) => {
          const top = (i / BUCKETS) * 100;
          if (bucket.folded) {
            return (
              <span
                key={i}
                className="timeline-fold"
                style={{ top: `${top}%`, height: `${100 / BUCKETS}%` }}
                aria-hidden
              />
            );
          }
          if (bucket.heat <= 0 || !bucket.anchorId) return null;
          const anchorId = bucket.anchorId;
          return (
            <button
              key={i}
              type="button"
              className="timeline-tick"
              style={{
                top: `${top}%`,
                height: `${100 / BUCKETS}%`,
                // Heat reads as both opacity and width so a dense passage feels
                // weightier without turning into a chart.
                opacity: 0.32 + bucket.heat * 0.68,
                transform: `scaleX(${0.45 + bucket.heat * 0.55})`,
              }}
              aria-label={`Jump to a denser passage`}
              onClick={() => onJumpTo(anchorId)}
            />
          );
        })}

        {model.gaps.map((gap, i) => (
          <span
            key={`gap-${i}`}
            className="timeline-gap"
            style={{ top: `${gap.at * 100}%` }}
          >
            <span className="timeline-gap-rule" aria-hidden />
            <span className="timeline-gap-label">{gap.label}</span>
          </span>
        ))}

        {model.thumbAt !== null && (
          <span
            className="timeline-thumb"
            style={{ top: `${model.thumbAt * 100}%` }}
            aria-hidden
          />
        )}
      </div>

      {hover && model.spanLabel && (
        <span className="timeline-span" aria-hidden>
          {model.spanLabel}
        </span>
      )}
    </nav>
  );
}

/**
 * Derive the rail model from the message list. Messages bin by position into
 * BUCKETS bands; the densest band sets the heat scale. Gaps are placed at the
 * boundary between consecutive messages whose timestamps span >= an hour (the
 * same threshold the in-stream TimeGap uses, via literaryDuration). Folded
 * spans paint whichever buckets they cover.
 */
function buildModel(
  messages: DisplayMessage[],
  compactedRanges: CompactedRange[] | undefined,
  currentMsgId: string | null,
): TimelineModel {
  const n = messages.length;
  const counts = new Array<number>(BUCKETS).fill(0);
  const anchors = new Array<string | null>(BUCKETS).fill(null);
  const folded = new Array<boolean>(BUCKETS).fill(false);

  const bucketOf = (index: number) =>
    Math.min(BUCKETS - 1, Math.floor((index / n) * BUCKETS));

  for (let i = 0; i < n; i++) {
    const b = bucketOf(i);
    counts[b] += 1;
    if (anchors[b] === null) anchors[b] = messages[i].msg_id;
  }

  // Folded ranges → covered buckets. We resolve the range endpoints to indices
  // and paint every bucket in between, tolerant of ids the list no longer has.
  if (compactedRanges) {
    const indexOf = new Map<string, number>();
    messages.forEach((m, i) => indexOf.set(m.msg_id, i));
    for (const range of compactedRanges) {
      const from = indexOf.get(range.fromMsgId);
      const to = indexOf.get(range.toMsgId);
      if (from === undefined && to === undefined) continue;
      const lo = from ?? 0;
      const hi = to ?? n - 1;
      const a = Math.min(lo, hi);
      const z = Math.max(lo, hi);
      for (let i = a; i <= z; i++) folded[bucketOf(i)] = true;
    }
  }

  const max = Math.max(1, ...counts);
  const buckets: Bucket[] = counts.map((c, b) => ({
    heat: c / max,
    anchorId: anchors[b],
    folded: folded[b],
  }));

  // Time gaps between consecutive settled messages, positioned at the midpoint
  // of the two messages' rail positions.
  const gaps: GapMark[] = [];
  for (let i = 1; i < n; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.streaming || curr.streaming) continue;
    const a = Date.parse(prev.timestamp);
    const z = Date.parse(curr.timestamp);
    if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) continue;
    const label = literaryDuration(z - a);
    if (!label) continue;
    gaps.push({ at: (i - 0.5) / n, label });
  }

  let thumbAt: number | null = null;
  if (currentMsgId) {
    const idx = messages.findIndex((m) => m.msg_id === currentMsgId);
    if (idx >= 0) thumbAt = n > 1 ? idx / (n - 1) : 0;
  }

  const spanLabel = timeSpanLabel(messages);

  return { buckets, gaps, thumbAt, spanLabel };
}

/** "09:14 — 18:30" across the first and last timestamped messages. */
function timeSpanLabel(messages: DisplayMessage[]): string {
  const first = messages.find((m) => m.timestamp);
  const last = [...messages].reverse().find((m) => m.timestamp);
  if (!first || !last) return "";
  const a = formatTimestamp(first.timestamp);
  const z = formatTimestamp(last.timestamp);
  if (!a || !z) return "";
  return a === z ? a : `${a} — ${z}`;
}
