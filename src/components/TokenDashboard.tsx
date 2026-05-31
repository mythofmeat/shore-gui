import { useEffect, useMemo } from "react";
import "../styles/token-dashboard.css";
import {
  formatTokenCount,
  sumTokenUsage,
  type DisplayMessage,
  type TokenUsage,
} from "../lib/messages.ts";
import { cumulativeCost, costForMessage, formatCost } from "../lib/cost.ts";

interface TokenDashboardProps {
  open: boolean;
  onClose: () => void;
  messages: DisplayMessage[];
}

/** The four token classes, in stacking order (cheap→expensive-ish), with the
 *  token color tokens used for both the chart and the legend. */
const SERIES: { key: keyof TokenUsage; label: string; color: string }[] = [
  { key: "cache_read", label: "cache read", color: "var(--ink-ghost)" },
  { key: "input", label: "input", color: "var(--ink-mute)" },
  { key: "cache_write", label: "cache write", color: "var(--ember-dim)" },
  { key: "output", label: "output", color: "var(--ember)" },
];

/**
 * Token & cost dashboard (#34). An overlay (cmd-overlay / cmd-palette shell,
 * capture-phase Escape) that beats the TUI's single-number readouts: cumulative
 * usage across all four token classes, the prompt-cache hit rate, an optional
 * cost figure (when the model is priced — see src/lib/cost.ts), and a per-turn
 * stacked bar chart hand-rolled in SVG (no chart dependency, to keep the bundle
 * small). Purely derived from the messages it is handed; owns no daemon state.
 */
export function TokenDashboard({ open, onClose, messages }: TokenDashboardProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  const model = useMemo(() => buildModel(messages), [messages]);

  if (!open) return null;

  const total = sumTokenUsage(messages);
  const totalAll = total.input + total.output + total.cache_read + total.cache_write;
  // Cache hit rate: reads served from cache vs. all "would-be input" tokens.
  const cacheBase = total.input + total.cache_read;
  const hitRate = cacheBase > 0 ? total.cache_read / cacheBase : 0;
  const { cost, priced } = cumulativeCost(messages);

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette token-dashboard"
        role="dialog"
        aria-modal="true"
        aria-label="Tokens and cost"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">∑</span>
          <span className="inject-title">Tokens &amp; cost</span>
        </div>

        {totalAll === 0 ? (
          <div className="cmd-empty">No usage recorded yet</div>
        ) : (
          <>
            <div className="td-cards">
              <Card label="input" value={formatTokenCount(total.input)} />
              <Card label="output" value={formatTokenCount(total.output)} />
              <Card label="cache read" value={formatTokenCount(total.cache_read)} />
              <Card label="cache write" value={formatTokenCount(total.cache_write)} />
              <Card label="cache hit" value={`${Math.round(hitRate * 100)}%`} accent />
              <Card
                label="cost"
                value={priced ? formatCost(cost.total) : "—"}
                accent
                title={priced ? undefined : "No price configured for this model"}
              />
            </div>

            {model.turns.length > 0 ? (
              <>
                <div className="td-chart-head">
                  <span>tokens per turn</span>
                  <span className="td-chart-scale">
                    peak {formatTokenCount(model.max)}
                  </span>
                </div>
                <TurnChart model={model} />
                <div className="td-legend">
                  {SERIES.map((s) => (
                    <span key={s.key} className="td-legend-item">
                      <span
                        className="td-swatch"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      {s.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="cmd-arg-hint">Per-turn metadata not available.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  accent,
  title,
}: {
  label: string;
  value: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <div className={accent ? "td-card td-card-accent" : "td-card"} title={title}>
      <span className="td-card-value">{value}</span>
      <span className="td-card-label">{label}</span>
    </div>
  );
}

interface Turn {
  msgId: string;
  tokens: TokenUsage;
  total: number;
  cost: number | null;
}
interface ChartModel {
  turns: Turn[];
  max: number;
}

function buildModel(messages: DisplayMessage[]): ChartModel {
  const turns: Turn[] = [];
  for (const m of messages) {
    const tokens = m.metadata?.tokens;
    if (m.role !== "assistant" || !tokens) continue;
    const total = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write;
    if (total <= 0) continue;
    const breakdown = costForMessage(m);
    turns.push({ msgId: m.msg_id, tokens, total, cost: breakdown ? breakdown.total : null });
  }
  const max = turns.reduce((acc, t) => Math.max(acc, t.total), 0);
  return { turns, max };
}

// Hand-rolled stacked bar chart. A fixed viewBox keeps it crisp at any width;
// bars stack the four token classes bottom-up.
const VB_W = 1000;
const VB_H = 220;
const PAD = 4;

function TurnChart({ model }: { model: ChartModel }) {
  const { turns, max } = model;
  const n = turns.length;
  const slot = VB_W / n;
  const barW = Math.max(1, Math.min(slot - 2, slot * 0.7));
  const scale = (v: number) => (max > 0 ? (v / max) * (VB_H - PAD * 2) : 0);

  return (
    <svg
      className="td-chart"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Tokens per turn"
    >
      {/* faint baseline */}
      <line
        x1={0}
        y1={VB_H - PAD}
        x2={VB_W}
        y2={VB_H - PAD}
        className="td-axis"
      />
      {turns.map((turn, i) => {
        const x = i * slot + (slot - barW) / 2;
        let y = VB_H - PAD;
        return (
          <g key={turn.msgId}>
            <title>
              {`${formatTokenCount(turn.total)} tok${
                turn.cost !== null ? ` · ${formatCost(turn.cost)}` : ""
              }`}
            </title>
            {SERIES.map((s) => {
              const h = scale(turn.tokens[s.key]);
              if (h <= 0) return null;
              y -= h;
              return (
                <rect
                  key={s.key}
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  fill={s.color}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
