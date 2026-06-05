import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Avatar } from "./Avatar.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { JsonTree } from "./JsonTree.tsx";
import { MessageContextMenu, type ContextMenuItem } from "./MessageContextMenu.tsx";
import { LinkPreview, extractUrls } from "./LinkPreview.tsx";
import { ImageGallery } from "./ImageGallery.tsx";
import { useUiSettings } from "../hooks/useUiSettings.ts";
import { speechSupported, speak, cancelSpeech } from "../lib/speech.ts";
import { MSG_DRAG_MIME } from "../lib/dnd.ts";
import "../styles/tool-inspector.css";
import "../styles/speech.css";
import "../styles/search.css";
import "../styles/dnd.css";
import type { CharacterInfo } from "../hooks/useDaemon.ts";
import {
  formatTimestamp,
  formatTokenCount,
  pairTools,
  truncateInput,
  type DisplayMessage,
  type ImageRef,
  type PairedTool,
  type StreamMetadata,
} from "../lib/messages.ts";
import { useViewSettings } from "../hooks/useViewSettings.ts";

interface MessageProps {
  message: DisplayMessage;
  characterName: string;
  /**
   * The active character (#20). When it carries an avatar, the assistant
   * name-line renders it in place of the ember Sigil; otherwise the Avatar
   * falls back to the Sigil.
   */
  character?: CharacterInfo | null;
  onImageClick?: (image: ImageRef, index: number) => void;
  /**
   * Called when the per-message edit affordance is clicked (#11). Receives the
   * message so the host can pull its content into the composer. Omitted (or
   * suppressed while streaming) when editing is not available.
   */
  onEdit?: (message: DisplayMessage) => void;
  /**
   * Called when the per-message delete affordance is confirmed (#12). Receives
   * the message so the host can dispatch command("delete", …). The action row
   * runs its own inline confirm step before invoking this. Omitted (or
   * suppressed while streaming) when deletion is not available.
   */
  onDelete?: (message: DisplayMessage) => void;
  /**
   * Called when the per-message regenerate affordance is confirmed (#9).
   * Receives optional guidance text. Offered only on the latest assistant turn
   * (the host gates this by passing it to that message alone) and never while
   * streaming. The daemon re-rolls the reply via ClientMessage::Regen.
   */
  onRegen?: (guidance?: string) => void;
  /**
   * Called when the per-message alternatives affordance is clicked (#10).
   * Receives the message so the host can open the alt picker scoped to that
   * assistant turn. Offered on settled assistant turns only.
   */
  onAlts?: (message: DisplayMessage) => void;
  /**
   * Active full-text search (#30). When present, message bodies render as
   * highlighted plain text with the query marked; the message whose id equals
   * `activeMsgId` gets the emphasized "active match" styling.
   */
  search?: { query: string; activeMsgId: string | null };
}

export function Message({
  message,
  characterName,
  character,
  onImageClick,
  onEdit,
  onDelete,
  onRegen,
  onAlts,
  search,
}: MessageProps) {
  const time = formatTimestamp(message.timestamp);
  const streaming = message.streaming === true;
  const { showThinking, showImages, showTools, showMetadata } = useViewSettings();
  const { linkPreviews } = useUiSettings();
  // Bare URLs to unfurl (#40), only when the user opted in and the turn settled.
  const links =
    linkPreviews && message.streaming !== true
      ? extractUrls(message.content)
      : [];
  const images = message.images ?? [];
  const renderImages = showImages && images.length > 0;
  const tools = pairTools(message.toolCalls ?? [], message.toolResults ?? []);
  const renderTools = showTools && tools.length > 0;
  // Per-message actions are offered on settled turns only — never on a live
  // stream. Edit is wired per-role below; delete applies to any settled turn.
  const canEdit = !streaming && Boolean(onEdit);
  const canDelete = !streaming && Boolean(onDelete);
  // Regenerate is offered only on the latest assistant turn (the host passes
  // onRegen to that message alone) and never while streaming.
  const canRegen = !streaming && Boolean(onRegen);
  // Alternatives are offered on settled assistant turns (the host passes onAlts
  // to those messages); never while streaming.
  const canAlts = !streaming && Boolean(onAlts);
  const showActions = canEdit || canDelete || canRegen || canAlts;

  // Right-click context menu (#32). Built once per render; actions are gated by
  // whichever callbacks the host passes for this message's role.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: ReactMouseEvent) => {
    // Defer to the native menu over links / images / code so copy + open-link
    // still work there.
    if ((e.target as HTMLElement).closest("a, img, .code-block")) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };
  const contextItems: ContextMenuItem[] = [
    {
      label: "Copy text",
      onSelect: () => void navigator.clipboard?.writeText(message.content).catch(() => {}),
    },
    {
      label: "Copy message id",
      onSelect: () => void navigator.clipboard?.writeText(message.msg_id).catch(() => {}),
    },
    {
      label: "Quote into composer",
      onSelect: () =>
        window.dispatchEvent(
          new CustomEvent("shore-gui:quote", { detail: { text: message.content } }),
        ),
    },
  ];
  if (canEdit) contextItems.push({ label: "Edit", onSelect: () => onEdit?.(message) });
  if (canRegen) contextItems.push({ label: "Regenerate", onSelect: () => onRegen?.() });
  if (canAlts) contextItems.push({ label: "Alternatives", onSelect: () => onAlts?.(message) });
  if (canDelete)
    contextItems.push({ label: "Delete", danger: true, onSelect: () => onDelete?.(message) });
  // Drag-out is unreliable from a WebView, so the robust "save image to disk"
  // path (#33) is a context-menu action backed by the save_image_bytes command.
  const savableImage = (message.images ?? []).find((im) => im.data);
  if (savableImage) {
    contextItems.push({
      label: "Save image…",
      onSelect: () =>
        void invoke("save_image_bytes", {
          dataBase64: savableImage.data,
          suggestedName: imageName(savableImage.path),
        }).catch(() => {}),
    });
  }
  const menuEl =
    menuPos !== null ? (
      <MessageContextMenu
        x={menuPos.x}
        y={menuPos.y}
        items={contextItems}
        onClose={() => setMenuPos(null)}
      />
    ) : null;

  if (message.role === "user") {
    return (
      <div
        className="msg user"
        data-msg-id={message.msg_id}
        onContextMenu={onContextMenu}
      >
        <Body content={message.content} search={search} msgId={message.msg_id} />
        {renderImages && (
          <ImageGallery images={images} onImageClick={onImageClick} />
        )}
        {links.length > 0 && (
          <div className="link-cards">
            {links.map((u) => (
              <LinkPreview key={u} url={u} />
            ))}
          </div>
        )}
        {message.content.length > 0 && <DragGrip text={message.content} />}
        {time && <div className="msg-meta">{time}</div>}
        {showActions && (
          <MessageActions
            onEdit={canEdit ? () => onEdit?.(message) : undefined}
            onDelete={canDelete ? () => onDelete?.(message) : undefined}
            align="right"
          />
        )}
        {menuEl}
      </div>
    );
  }

  if (message.role === "assistant") {
    const thinking = message.thinking ?? "";
    const renderThinking = showThinking && thinking.length > 0;
    return (
      <div
        className="msg char"
        data-msg-id={message.msg_id}
        onContextMenu={onContextMenu}
      >
        <div className="name-line">
          <Avatar character={character} size={18} streaming={streaming} />
          <span className="name">{characterName}</span>
          {showMetadata && streaming && (
            <StreamStatus phase={message.phase} model={message.model} />
          )}
          {!streaming && message.content.length > 0 && (
            <ReadAloudButton text={message.content} />
          )}
          {!streaming && message.content.length > 0 && (
            <DragGrip text={message.content} />
          )}
        </div>
        {renderThinking && (
          <ThinkingBlock text={thinking} streaming={streaming} />
        )}
        {renderTools && <ToolActivity tools={tools} />}
        <div className="body">
          <Body
            content={message.content}
            streaming={streaming}
            search={search}
            msgId={message.msg_id}
          />
        </div>
        {renderImages && (
          <ImageGallery images={images} onImageClick={onImageClick} />
        )}
        {links.length > 0 && (
          <div className="link-cards">
            {links.map((u) => (
              <LinkPreview key={u} url={u} />
            ))}
          </div>
        )}
        {!streaming && showMetadata && (
          <MessageMetadata
            metadata={message.metadata ?? null}
            finishReason={message.finishReason ?? null}
          />
        )}
        {!streaming && time && <div className="msg-meta">{time}</div>}
        {showActions && (
          <MessageActions
            onEdit={canEdit ? () => onEdit?.(message) : undefined}
            onDelete={canDelete ? () => onDelete?.(message) : undefined}
            onRegen={canRegen ? (guidance) => onRegen?.(guidance) : undefined}
            onAlts={canAlts ? () => onAlts?.(message) : undefined}
            align="left"
          />
        )}
        {menuEl}
      </div>
    );
  }

  return (
    <div
      className="msg user"
      data-msg-id={message.msg_id}
      onContextMenu={onContextMenu}
      style={{ opacity: 0.6, fontStyle: "italic" }}
    >
      <Body content={message.content} search={search} msgId={message.msg_id} />
      {renderImages && (
        <ImageGallery images={images} onImageClick={onImageClick} />
      )}
      {canDelete && (
        <MessageActions
          onDelete={() => onDelete?.(message)}
          align="left"
        />
      )}
      {menuEl}
    </div>
  );
}

interface MessageActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
  /** Regenerate the reply, optionally with guidance text (#9). */
  onRegen?: (guidance?: string) => void;
  /** Open the alternatives picker for this turn (#10). */
  onAlts?: () => void;
  align: "left" | "right";
}

/**
 * Hover action-row shared across per-message affordances (#11 edit; #12 delete).
 * Visually quiet until the message is hovered or focused-within. `align` mirrors
 * the row to match the message's text alignment.
 *
 * Delete uses an inline confirm step (#12): the first click swaps the row for a
 * "Delete? · yes / no" prompt rather than firing immediately, so a stray click
 * cannot destroy a turn. Confirming invokes onDelete; the daemon's history
 * update (or an error notice) provides the actual feedback.
 */
function MessageActions({ onEdit, onDelete, onRegen, onAlts, align }: MessageActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [guidance, setGuidance] = useState("");

  if (guiding && onRegen) {
    const submit = () => {
      const trimmed = guidance.trim();
      setGuiding(false);
      setGuidance("");
      onRegen(trimmed.length > 0 ? trimmed : undefined);
    };
    return (
      <div className={`msg-actions msg-actions-${align}`} role="group">
        <input
          type="text"
          className="msg-action-guidance"
          value={guidance}
          autoFocus
          placeholder="Guidance (optional)…"
          onChange={(e) => setGuidance(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              // Scoped: don't let Escape reach the global stream-cancel handler.
              e.preventDefault();
              e.stopPropagation();
              setGuiding(false);
              setGuidance("");
            }
          }}
        />
        <button
          type="button"
          className="msg-action"
          onClick={submit}
          title="Regenerate"
          aria-label="Regenerate"
        >
          <span>Regenerate</span>
        </button>
        <button
          type="button"
          className="msg-action"
          onClick={() => {
            setGuiding(false);
            setGuidance("");
          }}
          title="Cancel regenerate"
          aria-label="Cancel regenerate"
        >
          <span>Cancel</span>
        </button>
      </div>
    );
  }

  if (confirming && onDelete) {
    return (
      <div className={`msg-actions msg-actions-${align}`} role="group">
        <span className="msg-action-confirm-label">Delete message?</span>
        <button
          type="button"
          className="msg-action msg-action-danger"
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
          title="Confirm delete"
          aria-label="Confirm delete"
        >
          <span>Delete</span>
        </button>
        <button
          type="button"
          className="msg-action"
          onClick={() => setConfirming(false)}
          title="Cancel delete"
          aria-label="Cancel delete"
        >
          <span>Cancel</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`msg-actions msg-actions-${align}`}>
      {onRegen && (
        <button
          type="button"
          className="msg-action"
          onClick={() => setGuiding(true)}
          title="Regenerate reply"
          aria-label="Regenerate reply"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          <span>Regenerate</span>
        </button>
      )}
      {onAlts && (
        <button
          type="button"
          className="msg-action"
          onClick={onAlts}
          title="Browse alternate replies"
          aria-label="Browse alternate replies"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <span>Alternatives</span>
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          className="msg-action"
          onClick={onEdit}
          title="Edit message"
          aria-label="Edit message"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>Edit</span>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="msg-action"
          onClick={() => setConfirming(true)}
          title="Delete message"
          aria-label="Delete message"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}

interface StreamStatusProps {
  phase?: string | null;
  model?: string | null;
}

function StreamStatus({ phase, model }: StreamStatusProps) {
  const parts = [phase, model].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  return <span className="stream-status">{parts.join(" · ")}</span>;
}

interface MessageMetadataProps {
  metadata: StreamMetadata | null;
  finishReason: string | null;
}

function MessageMetadata({ metadata, finishReason }: MessageMetadataProps) {
  if (!metadata && !finishReason) return null;
  const tokens = metadata?.tokens;
  const total = tokens ? tokens.input + tokens.output : 0;
  const summaryBits: string[] = [];
  if (finishReason) summaryBits.push(finishReason);
  if (tokens) summaryBits.push(`${formatTokenCount(total)} tok`);
  if (metadata?.model) summaryBits.push(metadata.model);

  return (
    <details className="msg-metadata">
      <summary>{summaryBits.join(" · ") || "metadata"}</summary>
      <dl className="metadata-grid">
        {tokens && (
          <>
            <dt>in</dt>
            <dd>{formatTokenCount(tokens.input)}</dd>
            <dt>out</dt>
            <dd>{formatTokenCount(tokens.output)}</dd>
            <dt>cache read</dt>
            <dd>{formatTokenCount(tokens.cache_read)}</dd>
            <dt>cache write</dt>
            <dd>{formatTokenCount(tokens.cache_write)}</dd>
          </>
        )}
        {metadata?.timing && metadata.timing.total_ms > 0 && (
          <>
            <dt>total</dt>
            <dd>{formatMs(metadata.timing.total_ms)}</dd>
          </>
        )}
        {metadata?.timing && metadata.timing.ttft_ms > 0 && (
          <>
            <dt>ttft</dt>
            <dd>{formatMs(metadata.timing.ttft_ms)}</dd>
          </>
        )}
        {finishReason && (
          <>
            <dt>finish</dt>
            <dd>{finishReason}</dd>
          </>
        )}
      </dl>
    </details>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
}

function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  return (
    <details className="thinking" open={streaming}>
      <summary>thinking</summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}

interface ToolActivityProps {
  tools: PairedTool[];
}

function ToolActivity({ tools }: ToolActivityProps) {
  return (
    <div className="tools">
      {tools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: PairedTool }) {
  const className = tool.isError ? "tool-call tool-error" : "tool-call";
  const status = tool.pending ? "…" : tool.isError ? "fail" : "ok";
  // Tool input/output get a collapsible JSON tree (#27) when they parse as
  // structured data; otherwise we fall back to the quiet truncated text.
  const inputJson = asJson(tool.input);
  const outputJson = tool.output !== undefined ? asJson(tool.output) : undefined;
  const curl = toCurl(tool.input);
  const inputCopy =
    inputJson !== undefined
      ? JSON.stringify(inputJson, null, 2)
      : tool.input === undefined
        ? ""
        : typeof tool.input === "string"
          ? tool.input
          : JSON.stringify(tool.input);

  return (
    <div className={className}>
      <div className="tool-head">
        <span className="tool-name">{tool.name || "tool"}</span>
        <span className="tool-status">{status}</span>
      </div>
      {inputJson !== undefined ? (
        <JsonTree value={inputJson} />
      ) : (
        truncateInput(tool.input) && (
          <div className="tool-input">{truncateInput(tool.input)}</div>
        )
      )}
      {!tool.pending && tool.output !== undefined && tool.output.length > 0 && (
        outputJson !== undefined ? (
          <JsonTree value={outputJson} />
        ) : (
          <div className="tool-result">{truncateInput(tool.output, 280)}</div>
        )
      )}
      {(inputCopy || curl) && (
        <div className="tool-actions">
          {inputCopy && <CopyButton label="copy json" text={inputCopy} />}
          {curl && <CopyButton label="copy curl" text={curl} />}
        </div>
      )}
    </div>
  );
}

/** A hover-revealed grip for dragging a message into the composer to quote it
 *  (#33). A dedicated handle keeps the message text selectable. */
function DragGrip({ text }: { text: string }) {
  return (
    <span
      className="msg-drag-grip"
      data-drag-handle="true"
      draggable
      title="Drag to quote into composer"
      aria-hidden
      onDragStart={(e) => {
        e.dataTransfer.setData(MSG_DRAG_MIME, text);
        e.dataTransfer.setData("text/plain", text);
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      ⠿
    </span>
  );
}

/** Derive a sensible save filename from an image's path. */
function imageName(path: string): string {
  const base = path.split(/[\\/]/).pop() || "image.png";
  return base.includes(".") ? base : `${base}.png`;
}

/** Render a message body: highlighted plain text while a search is active
 *  (#30), otherwise the normal markdown. */
function Body({
  content,
  streaming,
  search,
  msgId,
}: {
  content: string;
  streaming?: boolean;
  search?: { query: string; activeMsgId: string | null };
  msgId: string;
}) {
  if (search && search.query.trim()) {
    return (
      <HighlightedText
        text={content}
        query={search.query}
        active={search.activeMsgId === msgId}
      />
    );
  }
  return <MarkdownBody content={content} streaming={streaming} />;
}

/** Wrap case-insensitive matches of `query` in <mark>, emphasizing the active
 *  message's hits. Renders plain text (markdown is suspended during search). */
function HighlightedText({
  text,
  query,
  active,
}: {
  text: string;
  query: string;
  active: boolean;
}) {
  const q = query.trim();
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  let key = 0;
  let idx = lower.indexOf(ql);
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark
        key={key++}
        className={active ? "search-hit search-hit-active" : "search-hit"}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(ql, i);
  }
  parts.push(text.slice(i));
  return <div className="markdown search-plain">{parts}</div>;
}

/** Read-aloud toggle for an assistant message (#38). Hidden when the platform
 *  has no speech synthesis (e.g. some WebKitGTK builds). */
function ReadAloudButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (!speechSupported()) return null;
  const toggle = () => {
    if (speaking) {
      cancelSpeech();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      speak(text, () => setSpeaking(false));
    }
  };
  return (
    <button
      type="button"
      className="read-aloud"
      data-speaking={speaking}
      onClick={toggle}
      aria-label={speaking ? "Stop reading" : "Read aloud"}
      title={speaking ? "Stop reading" : "Read aloud"}
    >
      {speaking ? "◼" : "▶"}
    </button>
  );
}

/** A subtle copy-to-clipboard button with a brief "copied" acknowledgement. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1300);
      })
      .catch(() => {
        /* clipboard denied — stay quiet */
      });
  };
  return (
    <button type="button" className="tool-action" data-copied={copied} onClick={onClick}>
      {copied ? "copied" : label}
    </button>
  );
}

/** Coerce a tool payload to a JSON value for the tree: pass objects/arrays
 *  through; parse JSON-looking strings; otherwise undefined (use plain text). */
function asJson(value: unknown): unknown | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const t = value.trim();
    const looksJson =
      (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
    if (looksJson) {
      try {
        return JSON.parse(t);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Best-effort "copy as curl": only when the input looks like an HTTP request
 *  (carries a url + optional method/headers/body). Returns null otherwise. */
function toCurl(input: unknown): string | null {
  const obj =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : (() => {
          const j = asJson(input);
          return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
        })();
  if (!obj) return null;
  const url = obj.url ?? obj.uri ?? obj.endpoint;
  if (typeof url !== "string") return null;
  const method = typeof obj.method === "string" ? obj.method.toUpperCase() : "GET";
  const parts = [`curl -X ${method} ${shellQuote(url)}`];
  const headers = obj.headers;
  if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      parts.push(`-H ${shellQuote(`${k}: ${String(v)}`)}`);
    }
  }
  const body = obj.body ?? obj.data ?? obj.json;
  if (body !== undefined) {
    const b = typeof body === "string" ? body : JSON.stringify(body);
    parts.push(`-d ${shellQuote(b)}`);
  }
  return parts.join(" \\\n  ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
