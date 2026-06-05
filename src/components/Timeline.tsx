import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
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
  /**
   * The scroll container the rail mirrors. The thumb + progress fill track its
   * real scroll offset, and clicking/arrowing the rail scrolls it — so the rail
   * is always exactly in sync with the viewport (no index guesswork).
   */
  scrollerRef: RefObject<HTMLElement | null>;
  /** Optional folded spans, drawn as a distinct seam on the rail. */
  compactedRanges?: CompactedRange[];
}

interface Mark {
  /** Vertical position, 0..1 down the rail. */
  at: number;
  msgId: string;
  /** Assistant turns read a touch heavier than user turns on the rail. */
  assistant: boolean;
}

interface GapMark {
  /** Vertical position, 0..1 down the rail. */
  at: number;
  label: string;
}

interface FoldSpan {
  from: number;
  to: number;
}

interface TimelineModel {
  marks: Mark[];
  gaps: GapMark[];
  folds: FoldSpan[];
  /** Span label for the whole conversation, e.g. "09:14 — 18:30". */
  spanLabel: string;
}

/**
 * #29 — a slim conversation scrubber in the stream's right margin. At rest it is
 * a quiet hairline track with a faint reading-progress fill and a position
 * thumb, both pinned to the scroller's actual scroll offset. On hover it widens
 * to reveal a tick per turn, the time-gap labels and the overall span. Clicking
 * anywhere on the rail scrolls there; ↑/↓ step turn-by-turn. The scroll-driven
 * bits update via direct DOM writes so scrolling never re-renders React.
 */
export function Timeline({ messages, scrollerRef, compactedRanges }: TimelineProps) {
  const [hover, setHover] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);

  const model = useMemo<TimelineModel>(
    () => buildModel(messages, compactedRanges),
    [messages, compactedRanges],
  );

  const n = messages.length;

  // Mirror the scroller's scroll offset onto the thumb + fill. Done with direct
  // style writes (not state) so the 60fps scroll stream never re-renders. The
  // fraction is scrollTop / scrollable-range, so "full" === scrolled to bottom
  // and a click maps 1:1 to a scroll position.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const apply = () => {
      const range = el.scrollHeight - el.clientHeight;
      const f = range > 0 ? Math.min(1, Math.max(0, el.scrollTop / range)) : 0;
      const pct = `${f * 100}%`;
      if (thumbRef.current) thumbRef.current.style.top = pct;
      if (progressRef.current) progressRef.current.style.height = pct;
      railRef.current?.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    };

    apply();
    el.addEventListener("scroll", apply, { passive: true });
    // Content height changes (new turns, image/font loads) shift the mapping.
    const observed = el.querySelector(".stream-inner") ?? el;
    const ro = new ResizeObserver(apply);
    ro.observe(observed);
    return () => {
      el.removeEventListener("scroll", apply);
      ro.disconnect();
    };
  }, [scrollerRef, n]);

  // Nothing to scrub through until the conversation has some shape.
  if (n < 3) return null;

  const scrubToClientY = (clientY: number) => {
    const el = scrollerRef.current;
    const rect = railRef.current?.getBoundingClientRect();
    if (!el || !rect || rect.height === 0) return;
    const f = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    el.scrollTo({ top: f * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
  };

  // Step to the next/previous turn relative to the current scroll position.
  const stepTurn = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const containerTop = el.getBoundingClientRect().top;
    const tops = Array.from(el.querySelectorAll<HTMLElement>("[data-msg-id]")).map(
      (a) => a.getBoundingClientRect().top - containerTop + el.scrollTop,
    );
    const cur = el.scrollTop;
    let target: number | undefined;
    if (dir > 0) {
      target = tops.find((t) => t > cur + 2);
    } else {
      const before = tops.filter((t) => t < cur - 2);
      target = before.length > 0 ? before[before.length - 1] : 0;
    }
    if (target != null) el.scrollTo({ top: target, behavior: "smooth" });
  };

  const onRailClick = (e: ReactMouseEvent<HTMLDivElement>) => scrubToClientY(e.clientY);
  const onRailKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      stepTurn(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      stepTurn(-1);
    }
  };

  return (
    <nav
      className={`timeline${hover ? " timeline-open" : ""}`}
      aria-label="Conversation timeline"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="timeline-rail"
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label="Scrub conversation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        onClick={onRailClick}
        onKeyDown={onRailKeyDown}
      >
        <span className="timeline-track" aria-hidden />
        <span className="timeline-progress" ref={progressRef} aria-hidden />

        {model.folds.map((fold, i) => (
          <span
            key={`fold-${i}`}
            className="timeline-fold"
            style={{ top: `${fold.from * 100}%`, height: `${(fold.to - fold.from) * 100}%` }}
            aria-hidden
          />
        ))}

        {hover &&
          model.marks.map((mark) => (
            <span
              key={mark.msgId}
              className={`timeline-mark${mark.assistant ? " timeline-mark-char" : ""}`}
              style={{ top: `${mark.at * 100}%` }}
              aria-hidden
            />
          ))}

        {model.gaps.map((gap, i) => (
          <span
            key={`gap-${i}`}
            className="timeline-gap"
            style={{ top: `${gap.at * 100}%` }}
            aria-hidden
          >
            <span className="timeline-gap-label">{gap.label}</span>
            <span className="timeline-gap-rule" />
          </span>
        ))}

        <span className="timeline-thumb" ref={thumbRef} aria-hidden />
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
 * Derive the rail's static model (marks, gaps, folds, span) from the message
 * list. These are positioned by linear turn index — even spacing that reads as
 * a clean ladder. The thumb + fill, by contrast, follow the real scroll offset
 * (see the effect above), so "where you are" is always exact.
 */
function buildModel(
  messages: DisplayMessage[],
  compactedRanges: CompactedRange[] | undefined,
): TimelineModel {
  const n = messages.length;
  const frac = (index: number) => (n > 1 ? index / (n - 1) : 0);

  const marks: Mark[] = messages.map((m, i) => ({
    at: frac(i),
    msgId: m.msg_id,
    assistant: m.role === "assistant",
  }));

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
    gaps.push({ at: (frac(i - 1) + frac(i)) / 2, label });
  }

  const folds: FoldSpan[] = [];
  if (compactedRanges && compactedRanges.length > 0) {
    const indexOf = new Map<string, number>();
    messages.forEach((m, i) => indexOf.set(m.msg_id, i));
    for (const range of compactedRanges) {
      const from = indexOf.get(range.fromMsgId);
      const to = indexOf.get(range.toMsgId);
      if (from === undefined && to === undefined) continue;
      const lo = Math.min(from ?? 0, to ?? n - 1);
      const hi = Math.max(from ?? 0, to ?? n - 1);
      folds.push({ from: frac(lo), to: frac(hi) });
    }
  }

  return { marks, gaps, folds, spanLabel: timeSpanLabel(messages) };
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
