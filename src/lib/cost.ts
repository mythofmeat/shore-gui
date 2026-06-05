import type { DisplayMessage, TokenUsage } from "./messages.ts";

/**
 * A small, dependency-free cost model (#34). Prices are expressed in USD per
 * million tokens (per-Mtok), one rate per token class, because that is how the
 * vendor price sheets quote them. Token *counts* live in stream metadata; this
 * module turns counts into dollars.
 *
 * Editing prices: change `MODEL_PRICES` below — that is the single obvious
 * place. A model with no matching entry has no price, and any UI should render
 * its cost as an em dash ("—") rather than a misleading $0.00.
 */

/** Per-million-token prices (USD) for one model's four token classes. */
export interface ModelPrice {
  /** USD per 1M fresh input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M tokens read from the prompt cache (cheap). */
  cache_read: number;
  /** USD per 1M tokens written to the prompt cache (a surcharge over input). */
  cache_write: number;
}

/**
 * Default price table. Keys are matched case-insensitively as substrings of the
 * model id reported in stream metadata (e.g. "claude-3-5-sonnet-20241022"
 * matches "claude-3-5-sonnet"), longest key first, so specific entries win over
 * generic ones. Prices reflect published Anthropic list rates per Mtok and are
 * easy to retune — this is the one place to edit.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Claude 3.5 / 3.7
  "claude-3-5-haiku": { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1 },
  "claude-3-5-sonnet": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-3-7-sonnet": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  // Claude 3 family
  "claude-3-haiku": { input: 0.25, output: 1.25, cache_read: 0.03, cache_write: 0.3 },
  "claude-3-opus": { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  // Claude 4 family (Sonnet/Opus/Haiku list rates)
  "claude-haiku-4": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  "claude-sonnet-4": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-opus-4": { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
};

/** A resolved per-turn or cumulative cost breakdown, in USD. */
export interface CostBreakdown {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

const ZERO_COST: CostBreakdown = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  total: 0,
};

/**
 * Find the price for a model id against a price table. Matching is tolerant:
 * the model id (whatever the daemon reports) is lowercased and tested against
 * each key as a substring, longest key first so the most specific entry wins.
 * Returns null when nothing matches — callers render the cost as "—".
 */
export function priceForModel(
  model: string | null | undefined,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): ModelPrice | null {
  if (!model) return null;
  const id = model.toLowerCase();
  const keys = Object.keys(prices).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (id.includes(key.toLowerCase())) return prices[key];
  }
  return null;
}

/**
 * Cost of a single turn's token usage under a given price (per-Mtok → USD).
 * Returns null when no price is known, so the UI can distinguish "free" from
 * "unpriced".
 */
export function costForTokens(
  tokens: TokenUsage,
  price: ModelPrice | null,
): CostBreakdown | null {
  if (!price) return null;
  const input = (tokens.input / 1_000_000) * price.input;
  const output = (tokens.output / 1_000_000) * price.output;
  const cache_read = (tokens.cache_read / 1_000_000) * price.cache_read;
  const cache_write = (tokens.cache_write / 1_000_000) * price.cache_write;
  return {
    input,
    output,
    cache_read,
    cache_write,
    total: input + output + cache_read + cache_write,
  };
}

/**
 * Cost of one message, resolved from its own metadata (tokens + model). Returns
 * null if the message has no metadata or its model has no price.
 */
export function costForMessage(
  message: DisplayMessage,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): CostBreakdown | null {
  const meta = message.metadata;
  if (!meta) return null;
  const price = priceForModel(meta.model ?? message.model, prices);
  return costForTokens(meta.tokens, price);
}

/**
 * Cumulative cost across every message that carries priced metadata. Messages
 * whose model has no price are simply skipped (they contribute 0), and
 * `priced` reports whether *any* message could be priced so the UI can fall
 * back to "—" when the whole conversation is unpriced.
 */
export function cumulativeCost(
  messages: DisplayMessage[],
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): { cost: CostBreakdown; priced: boolean } {
  let priced = false;
  const cost = messages.reduce<CostBreakdown>((acc, message) => {
    const turn = costForMessage(message, prices);
    if (!turn) return acc;
    priced = true;
    return {
      input: acc.input + turn.input,
      output: acc.output + turn.output,
      cache_read: acc.cache_read + turn.cache_read,
      cache_write: acc.cache_write + turn.cache_write,
      total: acc.total + turn.total,
    };
  }, { ...ZERO_COST });
  return { cost, priced };
}

/**
 * Format a USD amount with sensible precision: sub-cent costs get more decimals
 * so they don't collapse to "$0.00". Pass `null` for unpriced → "—".
 */
export function formatCost(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
