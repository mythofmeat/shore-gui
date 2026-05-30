/**
 * Sampler-settings metadata + coercion (#22). The daemon exposes an
 * `EffectiveSamplerSnapshot` via `command("model_settings", {})` and accepts
 * per-key edits via `command("set_model_setting", { key, value })`.
 *
 * DAEMON SHAPE IS NOT COMPILE-CHECKABLE in this repo. The snapshot field names,
 * the per-key value coercion, the reasoning_effort enum's "off" sentinel, and
 * the reset shape are all taken from shore-tui and CENTRALIZED here so they are
 * trivial to retune once verified against a live daemon. See caveats.
 *
 * Snapshot field shape (tolerant): each key maps either to a scalar value, or
 * to an object carrying the value under one of `value`/`current`/`effective`
 * plus a scope/source under one of `scope`/`source`/`origin`.
 */

/** The editable sampler keys, in render order. */
export type SamplerKey =
  | "temperature"
  | "top_p"
  | "reasoning_effort"
  | "thinking_enabled"
  | "budget_tokens"
  | "max_output_tokens"
  | "cache_ttl";

/** How a key's value is typed for coercion when sending `set_model_setting`. */
export type SamplerKind = "number" | "bool" | "enum";

export interface SamplerFieldMeta {
  key: SamplerKey;
  label: string;
  kind: SamplerKind;
  /** Short hint shown under the field. */
  hint: string;
  /** For numeric fields: optional input constraints. */
  min?: number;
  max?: number;
  step?: number;
  /** For enum fields: the allowed option values (lowercase). */
  options?: string[];
}

/**
 * The reasoning_effort enum uses an "off" SENTINEL (a literal string) to mean
 * "no extended reasoning" — NOT null/None. Reset (value:null) restores the
 * provider/config default; selecting "off" explicitly disables it.
 */
export const REASONING_EFFORT_OFF = "off";
export const REASONING_EFFORT_OPTIONS = [
  REASONING_EFFORT_OFF,
  "low",
  "medium",
  "high",
] as const;

/** Ordered field metadata — the single source of truth for the editor UI. */
export const SAMPLER_FIELDS: SamplerFieldMeta[] = [
  {
    key: "temperature",
    label: "Temperature",
    kind: "number",
    hint: "Sampling randomness. Lower is more deterministic.",
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    key: "top_p",
    label: "Top-p",
    kind: "number",
    hint: "Nucleus sampling cutoff (0–1).",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "reasoning_effort",
    label: "Reasoning effort",
    kind: "enum",
    hint: 'Extended-reasoning budget. "off" disables it.',
    options: [...REASONING_EFFORT_OPTIONS],
  },
  {
    key: "thinking_enabled",
    label: "Thinking",
    kind: "bool",
    hint: "Whether the model emits a thinking block.",
  },
  {
    key: "budget_tokens",
    label: "Thinking budget",
    kind: "number",
    hint: "Max tokens allotted to thinking.",
    min: 0,
    step: 256,
  },
  {
    key: "max_output_tokens",
    label: "Max tokens",
    kind: "number",
    hint: "Upper bound on the response length.",
    min: 1,
    step: 128,
  },
  {
    key: "cache_ttl",
    label: "Cache TTL",
    kind: "number",
    hint: "Prompt-cache lifetime, in seconds.",
    min: 0,
    step: 60,
  },
];

/** A single field resolved from the snapshot, ready to render. */
export interface SamplerField {
  meta: SamplerFieldMeta;
  /** The current effective value (raw), or null if unset. */
  value: unknown;
  /** Where the value comes from (e.g. "config", "default", "session"). */
  scope: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined) return record[key];
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Resolves the snapshot into an ordered list of fields. Tolerant of both flat
 * scalar values and `{ value, scope }`-style entries; also unwraps a top-level
 * `settings`/`sampler`/`snapshot` container.
 */
export function parseSamplerSnapshot(data: unknown): SamplerField[] {
  const source = unwrapSnapshot(data);
  return SAMPLER_FIELDS.map((meta) => {
    const raw = source ? source[meta.key] : undefined;
    if (isRecord(raw)) {
      return {
        meta,
        value: firstDefined(raw, ["value", "current", "effective", "val"]) ?? null,
        scope: firstString(raw, ["scope", "source", "origin", "from"]),
      };
    }
    return { meta, value: raw ?? null, scope: null };
  });
}

function unwrapSnapshot(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  for (const key of ["settings", "sampler", "snapshot", "effective"]) {
    const v = data[key];
    if (isRecord(v)) return v;
  }
  return data;
}

/** Formats a raw value for display. */
export function formatSamplerValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Coerces a string/checkbox input back into the typed value the daemon expects.
 * Returns `{ value }` on success or `{ error }` when the input can't be parsed.
 */
export function coerceSamplerInput(
  meta: SamplerFieldMeta,
  raw: string | boolean,
): { value: unknown } | { error: string } {
  switch (meta.kind) {
    case "bool":
      return { value: typeof raw === "boolean" ? raw : raw === "true" };
    case "enum": {
      const v = String(raw).trim().toLowerCase();
      if (!v) return { error: "Choose a value." };
      if (meta.options && !meta.options.includes(v)) {
        return { error: `Expected one of: ${meta.options.join(", ")}.` };
      }
      return { value: v };
    }
    case "number": {
      const text = String(raw).trim();
      if (text.length === 0) return { error: "Enter a number." };
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: "Not a valid number." };
      if (meta.min !== undefined && n < meta.min) {
        return { error: `Must be ≥ ${meta.min}.` };
      }
      if (meta.max !== undefined && n > meta.max) {
        return { error: `Must be ≤ ${meta.max}.` };
      }
      return { value: n };
    }
  }
}

/**
 * The `value` payload for a per-key RESET. The daemon clears an override when
 * sent null (taken from shore-tui); centralized here so the reset shape is easy
 * to retune. See caveats.
 */
export const SAMPLER_RESET_VALUE = null;

/** A pre-fill string for an editable field, from its current value. */
export function editStringFor(field: SamplerField): string {
  if (field.value === null || field.value === undefined) return "";
  if (typeof field.value === "boolean") return field.value ? "true" : "false";
  return String(field.value);
}
