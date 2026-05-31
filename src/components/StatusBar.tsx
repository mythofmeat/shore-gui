import {
  formatTokenCount,
  sumTokenUsage,
  type DisplayMessage,
} from "../lib/messages.ts";
import { useViewSettings } from "../hooks/useViewSettings.ts";

interface StatusBarProps {
  messages: DisplayMessage[];
}

/**
 * Cumulative token/cache status bar, summing the per-message stream metadata
 * across the visible conversation. Gated on the showMetadata view setting.
 */
export function StatusBar({ messages }: StatusBarProps) {
  const { showMetadata } = useViewSettings();
  if (!showMetadata) return null;

  const totals = sumTokenUsage(messages);
  const total = totals.input + totals.output;
  if (total === 0 && totals.cache_read === 0 && totals.cache_write === 0) {
    return null;
  }

  return (
    <div className="status-bar" role="status" aria-label="Cumulative token usage">
      <span className="status-stat">
        <span className="status-label">tok</span>
        <span className="status-value">{formatTokenCount(total)}</span>
      </span>
      <span className="status-stat">
        <span className="status-label">in</span>
        <span className="status-value">{formatTokenCount(totals.input)}</span>
      </span>
      <span className="status-stat">
        <span className="status-label">out</span>
        <span className="status-value">{formatTokenCount(totals.output)}</span>
      </span>
      <span className="status-stat">
        <span className="status-label">cache r/w</span>
        <span className="status-value">
          {formatTokenCount(totals.cache_read)}/{formatTokenCount(totals.cache_write)}
        </span>
      </span>
    </div>
  );
}
