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

/**
 * The three logical scopes a value can resolve from, normalized from whatever
 * label the daemon hands back (its scope strings aren't compile-checkable —
 * see caveats). `runtime` means an explicit per-session override is in effect;
 * `character` means the active character supplies it; `static_default` is the
 * config/provider baseline.
 */
export type SamplerScope = "static_default" | "character" | "runtime";

/** A single field resolved from the snapshot, ready to render. */
export interface SamplerField {
  meta: SamplerFieldMeta;
  /** The current effective value (raw), or null if unset. */
  value: unknown;
  /** The raw scope/source label as reported (kept for the tooltip). */
  scope: string | null;
  /** The normalized scope, or null when the label is unrecognized/absent. */
  resolvedScope: SamplerScope | null;
  /** Whether a runtime override is in effect (drives the "overridden" style). */
  overridden: boolean;
}

/** Human-facing labels for the normalized scopes (badge text). */
export const SAMPLER_SCOPE_LABELS: Record<SamplerScope, string> = {
  static_default: "default",
  character: "character",
  runtime: "override",
};

/**
 * Normalizes a raw scope/source label into one of the three logical scopes.
 * Tolerant of the several names shore-tui / the daemon might use; returns null
 * when nothing matches so the caller can fall back gracefully.
 */
export function classifySamplerScope(scope: string | null): SamplerScope | null {
  if (!scope) return null;
  const s = scope.trim().toLowerCase();
  if (!s) return null;
  if (
    /(runtime|session|override|overridden|user|live|manual|set)/.test(s)
  ) {
    return "runtime";
  }
  if (/(character|persona|card|char)/.test(s)) return "character";
  if (
    /(default|static|config|provider|base|builtin|built-in|fallback)/.test(s)
  ) {
    return "static_default";
  }
  return null;
}

/** Coarse fallback slider bounds for numeric keys whose meta omits a max. */
const SLIDER_FALLBACK_MAX: Partial<Record<SamplerKey, number>> = {
  temperature: 2,
  top_p: 1,
  budget_tokens: 32_000,
  max_output_tokens: 16_000,
  cache_ttl: 3_600,
};

/**
 * Resolves the min/max/step a range slider should use for a numeric field,
 * filling in sane fallbacks where `meta` leaves a bound open. The numeric
 * spinner still honors the looser `meta` bounds during coercion; the slider
 * just needs a finite track.
 */
export function sliderBoundsFor(meta: SamplerFieldMeta): {
  min: number;
  max: number;
  step: number;
} {
  const min = meta.min ?? 0;
  const max = meta.max ?? SLIDER_FALLBACK_MAX[meta.key] ?? min + 1;
  const step =
    meta.step ?? (max - min <= 2 ? 0.01 : Math.max(1, Math.round((max - min) / 100)));
  return { min, max: Math.max(max, min + step), step };
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
      const scope = firstString(raw, ["scope", "source", "origin", "from"]);
      const resolvedScope = classifySamplerScope(scope);
      // Prefer an explicit override flag if the daemon supplies one; otherwise
      // infer it from the normalized scope being "runtime". Stay tolerant.
      const overridden = readBoolean(
        raw,
        ["overridden", "is_override", "is_overridden", "override"],
      ) ?? resolvedScope === "runtime";
      return {
        meta,
        value: firstDefined(raw, ["value", "current", "effective", "val"]) ?? null,
        scope,
        resolvedScope,
        overridden,
      };
    }
    return {
      meta,
      value: raw ?? null,
      scope: null,
      resolvedScope: null,
      overridden: false,
    };
  });
}

function readBoolean(
  record: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "boolean") return v;
  }
  return null;
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
