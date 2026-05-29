export type MessageRole = "user" | "assistant" | "system";

export interface ImageRef {
  path: string;
  caption?: string | null;
  data?: string | null;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  content?: string;
  [key: string]: unknown;
}

export interface HistoryMessage {
  msg_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  images: ImageRef[];
  content_blocks: ContentBlock[];
  [key: string]: unknown;
}

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface StreamTiming {
  total_ms: number;
  ttft_ms: number;
}

export interface StreamMetadata {
  tokens: TokenUsage;
  timing: StreamTiming;
  model: string | null;
}

export interface StreamToolActivity {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  is_error?: boolean;
}

export interface ActiveStreamDraft {
  rid: string | null;
  content: string;
  thinking: string;
  startedAt: string;
  phase: string | null;
  model: string | null;
  regen: boolean;
  toolCalls: StreamToolActivity[];
  toolResults: StreamToolActivity[];
  images: ImageRef[];
}

export interface DisplayMessage {
  msg_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  streaming?: boolean;
  thinking?: string;
  phase?: string | null;
  model?: string | null;
  toolCalls?: StreamToolActivity[];
  toolResults?: StreamToolActivity[];
  images?: ImageRef[];
  metadata?: StreamMetadata | null;
  finishReason?: string | null;
}

const STREAMING_ID = "__streaming__";

export function coerceHistoryMessages(values: unknown): HistoryMessage[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const message = coerceHistoryMessage(value);
    return message ? [message] : [];
  });
}

export function coerceHistoryMessage(value: unknown): HistoryMessage | null {
  if (!isRecord(value)) return null;

  const msgId = stringValue(value.msg_id);
  if (!msgId) return null;

  const role = normalizeRole(stringValue(value.role));
  const content =
    stringValue(value.content) ?? contentFromBlocks(value.content_blocks) ?? "";
  const timestamp = stringValue(value.timestamp) ?? "";
  const images = Array.isArray(value.images)
    ? value.images.flatMap((image) => {
        if (!isRecord(image)) return [];
        const path = stringValue(image.path);
        if (!path) return [];
        return [
          {
            path,
            caption: stringValue(image.caption),
            data: stringValue(image.data),
          },
        ];
      })
    : [];
  const contentBlocks = Array.isArray(value.content_blocks)
    ? value.content_blocks.flatMap((block) =>
        isRecord(block) && typeof block.type === "string"
          ? [block as unknown as ContentBlock]
          : [],
      )
    : [];

  return {
    ...value,
    msg_id: msgId,
    role,
    content,
    timestamp,
    images,
    content_blocks: contentBlocks,
  };
}

export interface PairedTool {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  isError: boolean;
  pending: boolean;
}

/**
 * Pair tool results to their calls by tool_id so a single row can show the
 * tool name, its input, and its eventual pass/fail outcome. A call without a
 * matching result is rendered as pending.
 */
export function pairTools(
  calls: StreamToolActivity[],
  results: StreamToolActivity[],
): PairedTool[] {
  const resultById = new Map<string, StreamToolActivity>();
  for (const r of results) resultById.set(r.id, r);

  return calls.map((call) => {
    const result = resultById.get(call.id);
    return {
      id: call.id,
      name: call.name,
      input: call.input,
      output: result?.output,
      isError: result?.is_error === true,
      pending: result === undefined,
    };
  });
}

/**
 * Extract tool calls/results from a finished message's content_blocks
 * (tool_use / tool_result). Tool activity is normally only on the live stream
 * draft; this lets finished history messages render their tools too.
 */
export function toolsFromBlocks(blocks: ContentBlock[]): {
  toolCalls: StreamToolActivity[];
  toolResults: StreamToolActivity[];
} {
  const toolCalls: StreamToolActivity[] = [];
  const toolResults: StreamToolActivity[] = [];

  for (const block of blocks) {
    if (block.type === "tool_use") {
      const id = stringValue(block.id);
      if (!id) continue;
      toolCalls.push({
        id,
        name: stringValue(block.name) ?? "tool",
        input: block.input,
      });
    } else if (block.type === "tool_result") {
      const id = stringValue(block.tool_use_id);
      if (!id) continue;
      toolResults.push({
        id,
        name: "",
        output: stringValue(block.content) ?? undefined,
        is_error: block.is_error === true,
      });
    }
  }

  return { toolCalls, toolResults };
}

export function truncateInput(input: unknown, max = 160): string {
  if (input === undefined || input === null) return "";
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function toDisplayMessages(
  messages: HistoryMessage[],
  activeStream: ActiveStreamDraft | null,
): DisplayMessage[] {
  const display: DisplayMessage[] = messages.map((message) => {
    const thinking = thinkingFromBlocks(message.content_blocks);
    const { toolCalls, toolResults } = toolsFromBlocks(message.content_blocks);
    return {
      msg_id: message.msg_id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      images: message.images,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      metadata: coerceStreamMetadata(message.metadata),
      finishReason: stringValue(message.finish_reason),
    };
  });

  if (activeStream) {
    display.push({
      msg_id: streamDisplayId(activeStream.rid),
      role: "assistant",
      content: activeStream.content,
      timestamp: activeStream.startedAt,
      streaming: true,
      thinking: activeStream.thinking,
      phase: activeStream.phase,
      model: activeStream.model,
      toolCalls: activeStream.toolCalls,
      toolResults: activeStream.toolResults,
      images: activeStream.images,
    });
  }

  return display;
}

export function messageFromStreamEnd(
  frame: Record<string, unknown>,
  activeStream: ActiveStreamDraft | null,
): HistoryMessage | null {
  const msgId = stringValue(frame.msg_id);
  if (!msgId) return null;

  const content = stringValue(frame.content) ?? activeStream?.content ?? "";
  const thinking = activeStream?.thinking ?? "";
  const blocks: ContentBlock[] = [];
  if (thinking) blocks.push({ type: "thinking", thinking });
  if (content) blocks.push({ type: "text", text: content });
  return {
    msg_id: msgId,
    role: "assistant",
    content,
    timestamp:
      stringValue(frame.timestamp) ?? activeStream?.startedAt ?? new Date().toISOString(),
    images: activeStream?.images ?? [],
    content_blocks: blocks,
    metadata: frame.metadata,
    revision: frame.revision,
    finish_reason: frame.finish_reason,
  };
}

export function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

function englishNumber(n: number): string {
  return WORDS[n] ?? String(n);
}

export function literaryDuration(ms: number): string | null {
  const hour = 60 * 60 * 1000;
  if (ms < hour) return null;

  const hours = ms / hour;
  const days = hours / 24;

  if (hours < 1.75) return "an hour passes";
  if (hours < 12) return `${englishNumber(Math.round(hours))} hours pass`;
  if (hours < 20) return "most of a day passes";
  if (days < 1.75) return "a day passes";
  if (days < 7) return `${englishNumber(Math.round(days))} days pass`;
  if (days < 11) return "a week passes";
  if (days < 28) return `${englishNumber(Math.round(days / 7))} weeks pass`;
  if (days < 55) return "a month passes";
  if (days < 330) return `${englishNumber(Math.round(days / 30))} months pass`;
  return "a year passes";
}

export function coerceStreamMetadata(value: unknown): StreamMetadata | null {
  if (!isRecord(value)) return null;
  const tokens = coerceTokenUsage(value.tokens);
  const timing = isRecord(value.timing) ? value.timing : {};
  return {
    tokens,
    timing: {
      total_ms: numericValue(timing.total_ms) ?? 0,
      ttft_ms: numericValue(timing.ttft_ms) ?? 0,
    },
    model: stringValue(value.model),
  };
}

function coerceTokenUsage(value: unknown): TokenUsage {
  const record = isRecord(value) ? value : {};
  return {
    input: numericValue(record.input) ?? 0,
    output: numericValue(record.output) ?? 0,
    cache_read: numericValue(record.cache_read) ?? 0,
    cache_write: numericValue(record.cache_write) ?? 0,
  };
}

/** Sum token usage across messages that carry stream metadata. */
export function sumTokenUsage(messages: DisplayMessage[]): TokenUsage {
  return messages.reduce<TokenUsage>(
    (acc, message) => {
      const tokens = message.metadata?.tokens;
      if (!tokens) return acc;
      return {
        input: acc.input + tokens.input,
        output: acc.output + tokens.output,
        cache_read: acc.cache_read + tokens.cache_read,
        cache_write: acc.cache_write + tokens.cache_write,
      };
    },
    { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  );
}

/** Compact human-readable token count, e.g. 1234 -> "1.2k". */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function streamDisplayId(rid: string | null): string {
  return rid ? `${STREAMING_ID}:${rid}` : STREAMING_ID;
}

function normalizeRole(role: string | null): MessageRole {
  if (role === "user" || role === "assistant") return role;
  return "system";
}

function thinkingFromBlocks(blocks: ContentBlock[]): string {
  const parts = blocks.flatMap((block) => {
    if (block.type !== "thinking") return [];
    const text = stringValue(block.thinking) ?? stringValue(block.text);
    return text ? [text] : [];
  });
  return parts.join("");
}

function contentFromBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;

  const parts = blocks.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === "text") {
      const text = stringValue(block.text);
      return text !== null ? [text] : [];
    }
    if (block.type === "tool_result") {
      const content = stringValue(block.content);
      return content !== null ? [content] : [];
    }
    return [];
  });

  return parts.length > 0 ? parts.join("") : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
