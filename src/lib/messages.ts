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

export function toDisplayMessages(
  messages: HistoryMessage[],
  activeStream: ActiveStreamDraft | null,
): DisplayMessage[] {
  const display: DisplayMessage[] = messages.map((message) => ({
    msg_id: message.msg_id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    images: message.images,
  }));

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
  return {
    msg_id: msgId,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    images: activeStream?.images ?? [],
    content_blocks: content ? [{ type: "text", text: content }] : [],
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

function streamDisplayId(rid: string | null): string {
  return rid ? `${STREAMING_ID}:${rid}` : STREAMING_ID;
}

function normalizeRole(role: string | null): MessageRole {
  if (role === "user" || role === "assistant") return role;
  return "system";
}

function contentFromBlocks(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;

  const parts = blocks.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === "text") {
      const text = stringValue(block.text)?.trim();
      return text ? [text] : [];
    }
    if (block.type === "tool_result") {
      const content = stringValue(block.content)?.trim();
      return content ? [content] : [];
    }
    return [];
  });

  return parts.join("\n");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
