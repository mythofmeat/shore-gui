import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  coerceHistoryMessage,
  coerceHistoryMessages,
  messageFromStreamEnd,
  toDisplayMessages,
  type ActiveStreamDraft,
  type DisplayMessage,
  type HistoryMessage,
  type ImageRef,
  type StreamToolActivity,
} from "../lib/messages.ts";

const ADDR_KEY = "shore-gui:last-addr";
const MAX_NOTICES = 32;
const MAX_COMMAND_RESULTS = 32;

export type ConnectionStatus =
  | {
      kind: "connected";
      server_name: string;
      characters: CharacterInfo[];
      selected_character: string | null;
      history: unknown[];
      active_start: number;
      config: unknown;
    }
  | { kind: "disconnected"; reason: string };

export interface CharacterInfo {
  name: string;
  avatar?: {
    mime_type: string;
    data: string;
  };
}

export interface ServerMessageEvent {
  type: string;
  [key: string]: unknown;
}

export interface ProtocolNotice {
  id: string;
  kind:
    | "error"
    | "cache_warning"
    | "provider_fallback_warning"
    | "usage_warning"
    | "image";
  message: string;
  rid: string | null;
  createdAt: string;
  frame: ServerMessageEvent;
}

export interface CommandResult {
  rid: string | null;
  name: string;
  ok: boolean;
  createdAt: string;
  data?: unknown;
  error?: {
    code: string | null;
    message: string;
  };
}

interface PendingCommand {
  name: string;
  args: unknown;
  startedAt: string;
}

interface DaemonState {
  status: ConnectionStatus | null;
  history: HistoryMessage[];
  activeStart: number;
  revision: number;
  activeStream: ActiveStreamDraft | null;
  lastStreamEnd: ServerMessageEvent | null;
  notices: ProtocolNotice[];
  commandResults: CommandResult[];
  pendingCommands: Record<string, PendingCommand>;
}

export interface DaemonHandle {
  status: ConnectionStatus | null;
  messages: DisplayMessage[];
  history: HistoryMessage[];
  activeStream: ActiveStreamDraft | null;
  notices: ProtocolNotice[];
  latestNotice: ProtocolNotice | null;
  commandResults: CommandResult[];
  lastAddr: string;
  streaming: boolean;
  lastStreamEnd: ServerMessageEvent | null;
  connect: (addr?: string, character?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  cancel: () => Promise<void>;
  quit: () => Promise<void>;
  send: (text: string) => Promise<void>;
  command: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

type DaemonAction =
  | { type: "connection"; status: ConnectionStatus }
  | { type: "frame"; frame: ServerMessageEvent }
  | { type: "command_sent"; rid: string; name: string; args: unknown }
  | { type: "command_send_failed"; rid: string; name: string; message: string }
  | { type: "disconnected" };

const initialState: DaemonState = {
  status: null,
  history: [],
  activeStart: 0,
  revision: 0,
  activeStream: null,
  lastStreamEnd: null,
  notices: [],
  commandResults: [],
  pendingCommands: {},
};

function readStoredAddr(): string {
  try {
    return localStorage.getItem(ADDR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function useDaemon(): DaemonHandle {
  const [state, dispatch] = useReducer(reduceDaemonState, initialState);
  const lastAddrRef = useRef<string | null>(null);

  useEffect(() => {
    let unlistenStatus: UnlistenFn | undefined;
    let unlistenMsg: UnlistenFn | undefined;

    (async () => {
      unlistenStatus = await listen<ConnectionStatus>("connection-status", (e) => {
        dispatch({ type: "connection", status: e.payload });
        if (e.payload.kind === "connected") {
          try {
            localStorage.setItem(ADDR_KEY, lastAddrRef.current ?? "");
          } catch {
            // Storage can be unavailable in hardened WebViews.
          }
        }
      });
      unlistenMsg = await listen<ServerMessageEvent>("server-message", (e) => {
        dispatch({ type: "frame", frame: e.payload });
      });

      const stored = readStoredAddr();
      const addr = stored.length > 0 ? stored : null;
      lastAddrRef.current = addr;
      try {
        await invoke("connect", { addr, character: null });
      } catch (err) {
        console.error("auto-connect failed", err);
      }
    })();

    return () => {
      unlistenStatus?.();
      unlistenMsg?.();
    };
  }, []);

  const connect = useCallback(async (addr?: string, character?: string) => {
    const normalized = addr && addr.length > 0 ? addr : null;
    lastAddrRef.current = normalized;
    await invoke("connect", { addr: normalized, character: character ?? null });
  }, []);

  const disconnect = useCallback(async () => {
    dispatch({ type: "disconnected" });
    await invoke("disconnect");
  }, []);

  const cancel = useCallback(async () => {
    await invoke("cancel");
  }, []);

  const quit = useCallback(async () => {
    await invoke("quit");
  }, []);

  const send = useCallback(async (text: string) => {
    await invoke<string>("send_message", { text });
  }, []);

  const command = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    const rid = makeRid("cmd");
    dispatch({ type: "command_sent", rid, name, args });
    try {
      return await invoke<string>("send_command", { name, args, rid });
    } catch (err) {
      dispatch({
        type: "command_send_failed",
        rid,
        name,
        message: String(err),
      });
      throw err;
    }
  }, []);

  const messages = useMemo(
    () => toDisplayMessages(state.history, state.activeStream),
    [state.history, state.activeStream],
  );

  return {
    status: state.status,
    messages,
    history: state.history,
    activeStream: state.activeStream,
    notices: state.notices,
    latestNotice: state.notices.at(-1) ?? null,
    commandResults: state.commandResults,
    lastAddr: readStoredAddr(),
    streaming: state.activeStream !== null,
    lastStreamEnd: state.lastStreamEnd,
    connect,
    disconnect,
    cancel,
    quit,
    send,
    command,
  };
}

function reduceDaemonState(state: DaemonState, action: DaemonAction): DaemonState {
  switch (action.type) {
    case "connection":
      return reduceConnection(state, action.status);
    case "frame":
      return reduceFrame(state, action.frame);
    case "command_sent":
      return {
        ...state,
        pendingCommands: {
          ...state.pendingCommands,
          [action.rid]: {
            name: action.name,
            args: action.args,
            startedAt: new Date().toISOString(),
          },
        },
      };
    case "command_send_failed":
      return addNotice(
        {
          ...state,
          pendingCommands: withoutPendingCommand(state.pendingCommands, action.rid),
          commandResults: appendBounded(
            state.commandResults,
            {
              rid: action.rid,
              name: action.name,
              ok: false,
              createdAt: new Date().toISOString(),
              error: {
                code: "send_failed",
                message: action.message,
              },
            },
            MAX_COMMAND_RESULTS,
          ),
        },
        noticeFromFrame(
          {
            type: "error",
            rid: action.rid,
            code: "send_failed",
            message: action.message,
          },
          "error",
        ),
      );
    case "disconnected":
      return {
        ...state,
        activeStream: null,
        pendingCommands: {},
        status: state.status?.kind === "connected"
          ? { kind: "disconnected", reason: "disconnected" }
          : state.status,
      };
  }
}

function reduceConnection(state: DaemonState, status: ConnectionStatus): DaemonState {
  if (status.kind === "disconnected") {
    return {
      ...state,
      status,
      activeStream: null,
      pendingCommands: {},
    };
  }

  return {
    ...state,
    status,
    history: coerceHistoryMessages(status.history),
    activeStart: status.active_start,
    revision: 0,
    activeStream: null,
    lastStreamEnd: null,
  };
}

function reduceFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  switch (frame.type) {
    case "history":
      return reduceHistoryFrame(state, frame);
    case "new_message":
      return reduceNewMessageFrame(state, frame);
    case "stream_start":
      return reduceStreamStartFrame(state, frame);
    case "stream_chunk":
      return reduceStreamChunkFrame(state, frame);
    case "phase":
      return reducePhaseFrame(state, frame);
    case "tool_call":
      return reduceToolCallFrame(state, frame);
    case "tool_result":
      return reduceToolResultFrame(state, frame);
    case "send_image":
      return reduceSendImageFrame(state, frame);
    case "stream_end":
      return reduceStreamEndFrame(state, frame);
    case "command_output":
      return reduceCommandOutputFrame(state, frame);
    case "error":
      return reduceErrorFrame(state, frame);
    case "cache_warning":
      return addNotice(state, noticeFromFrame(frame, "cache_warning"));
    case "provider_fallback_warning":
      return addNotice(state, noticeFromFrame(frame, "provider_fallback_warning"));
    case "usage_warning":
      return addNotice(state, noticeFromFrame(frame, "usage_warning"));
    case "shutdown":
      return {
        ...state,
        status: { kind: "disconnected", reason: "server shutdown" },
        activeStream: null,
        pendingCommands: {},
      };
    case "ping":
    case "hello":
      return state;
    default:
      return addNotice(
        state,
        noticeFromFrame(
          {
            ...frame,
            message: `Unhandled SWP frame: ${frame.type}`,
          },
          "error",
        ),
      );
  }
}

function reduceStreamStartFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame) ?? newStreamDraft(frame);
  return {
    ...state,
    activeStream: {
      ...stream,
      rid: stream.rid ?? stringValue(frame.rid),
      regen: stream.regen || frame.regen === true,
    },
    lastStreamEnd: null,
  };
}

function reduceHistoryFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const revision = numericValue(frame.revision);
  if (isStaleRevision(state, revision)) return state;

  const status = mergeHistoryIntoStatus(state.status, frame);
  return {
    ...state,
    status,
    history: coerceHistoryMessages(frame.messages),
    activeStart: numericValue(frame.active_start) ?? 0,
    revision: Math.max(state.revision, revision ?? state.revision),
    activeStream: requestMatches(state.activeStream, stringValue(frame.rid))
      ? null
      : state.activeStream,
  };
}

function reduceNewMessageFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const revision = numericValue(frame.revision);
  if (isStaleRevision(state, revision)) return state;

  const message = coerceHistoryMessage(stripNewMessageEnvelope(frame));
  if (!message) return state;

  return {
    ...state,
    history: appendOrReplaceMessage(state.history, message),
    revision: Math.max(state.revision, revision ?? state.revision),
    activeStream:
      state.activeStream && message.role === "assistant" ? null : state.activeStream,
  };
}

function reduceStreamChunkFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame);
  if (!stream) return state;

  const text = stringValue(frame.text) ?? "";
  const contentType = stringValue(frame.content_type) ?? "text";

  return {
    ...state,
    activeStream:
      contentType === "thinking"
        ? { ...stream, thinking: stream.thinking + text }
        : { ...stream, content: stream.content + text },
  };
}

function reducePhaseFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame);
  if (!stream) return state;

  return {
    ...state,
    activeStream: {
      ...stream,
      phase: stringValue(frame.phase),
      model: stringValue(frame.model),
    },
  };
}

function reduceToolCallFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame);
  if (!stream) return state;

  const call = toolActivityFromFrame(frame);
  if (!call) return state;

  return {
    ...state,
    activeStream: {
      ...stream,
      phase: "tool_use",
      toolCalls: appendBounded(stream.toolCalls, call, 24),
    },
  };
}

function reduceToolResultFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame);
  if (!stream) return state;

  const result = toolActivityFromFrame(frame);
  if (!result) return state;

  return {
    ...state,
    activeStream: {
      ...stream,
      toolResults: appendBounded(stream.toolResults, result, 24),
    },
  };
}

function reduceSendImageFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const stream = matchingStream(state.activeStream, frame);
  if (!stream) return state;

  const path = stringValue(frame.path);
  if (!path) return state;

  const image: ImageRef = {
    path,
    caption: stringValue(frame.caption),
    data: stringValue(frame.data),
  };

  return addNotice(
    {
      ...state,
      activeStream: {
        ...stream,
        images: appendBounded(stream.images, image, 12),
      },
    },
    noticeFromFrame(frame, "image"),
  );
}

function reduceStreamEndFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const revision = numericValue(frame.revision);
  if (isStaleRevision(state, revision)) return state;

  const isFinal = frame.is_final !== false;
  const content = stringValue(frame.content);
  const currentStream = matchingStream(state.activeStream, frame);
  const nextRevision = Math.max(state.revision, revision ?? state.revision);
  if (!currentStream) return state;

  const stream = content
    ? { ...currentStream, content: longest(currentStream.content, content) }
    : currentStream;

  if (!isFinal) {
    return {
      ...state,
      activeStream: stream,
      revision: nextRevision,
    };
  }

  const message = messageFromStreamEnd(frame, stream);
  return {
    ...state,
    history: message ? appendOrReplaceMessage(state.history, message) : state.history,
    revision: nextRevision,
    activeStream: null,
    lastStreamEnd: frame,
  };
}

function reduceCommandOutputFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const rid = stringValue(frame.rid);
  const name = stringValue(frame.name) ?? pendingCommandName(state, rid) ?? "command";
  const result: CommandResult = {
    rid,
    name,
    ok: true,
    data: frame.data,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    pendingCommands: withoutPendingCommand(state.pendingCommands, rid),
    commandResults: appendBounded(state.commandResults, result, MAX_COMMAND_RESULTS),
  };
}

function reduceErrorFrame(state: DaemonState, frame: ServerMessageEvent): DaemonState {
  const rid = stringValue(frame.rid);
  const pendingName = pendingCommandName(state, rid);
  const message = stringValue(frame.message) ?? "request failed";
  const notice = noticeFromFrame(frame, "error");
  const result: CommandResult | null = pendingName
    ? {
        rid,
        name: pendingName,
        ok: false,
        createdAt: new Date().toISOString(),
        error: {
          code: stringValue(frame.code),
          message,
        },
      }
    : null;

  return addNotice(
    {
      ...state,
      activeStream: requestMatches(state.activeStream, rid) ? null : state.activeStream,
      pendingCommands: withoutPendingCommand(state.pendingCommands, rid),
      commandResults: result
        ? appendBounded(state.commandResults, result, MAX_COMMAND_RESULTS)
        : state.commandResults,
    },
    notice,
  );
}

function newStreamDraft(frame: ServerMessageEvent): ActiveStreamDraft {
  return {
    rid: stringValue(frame.rid),
    content: "",
    thinking: "",
    startedAt: new Date().toISOString(),
    phase: null,
    model: null,
    regen: frame.regen === true,
    toolCalls: [],
    toolResults: [],
    images: [],
  };
}

function matchingStream(
  stream: ActiveStreamDraft | null,
  frame: ServerMessageEvent,
): ActiveStreamDraft | null {
  const rid = stringValue(frame.rid);
  if (!stream || (rid && stream.rid && stream.rid !== rid)) return null;
  return stream;
}

function stripNewMessageEnvelope(frame: ServerMessageEvent): Record<string, unknown> {
  const { type, revision, character, origin, ...message } = frame;
  void type;
  void revision;
  void character;
  void origin;
  return message;
}

function mergeHistoryIntoStatus(
  status: ConnectionStatus | null,
  frame: ServerMessageEvent,
): ConnectionStatus | null {
  if (!status || status.kind !== "connected") return status;
  return {
    ...status,
    history: Array.isArray(frame.messages) ? frame.messages : [],
    active_start: numericValue(frame.active_start) ?? status.active_start,
    selected_character:
      stringValue(frame.selected_character) ?? status.selected_character,
    config: frame.config ?? status.config,
  };
}

function appendOrReplaceMessage(
  messages: HistoryMessage[],
  message: HistoryMessage,
): HistoryMessage[] {
  const existingIndex = messages.findIndex((item) => item.msg_id === message.msg_id);
  if (existingIndex < 0) return [...messages, message];

  const next = [...messages];
  next[existingIndex] = message;
  return next;
}

function addNotice(state: DaemonState, notice: ProtocolNotice): DaemonState {
  return {
    ...state,
    notices: appendBounded(state.notices, notice, MAX_NOTICES),
  };
}

function noticeFromFrame(
  frame: ServerMessageEvent,
  kind: ProtocolNotice["kind"],
): ProtocolNotice {
  return {
    id: `${kind}:${stringValue(frame.rid) ?? "push"}:${Date.now()}:${Math.random()}`,
    kind,
    rid: stringValue(frame.rid),
    message: noticeMessage(frame, kind),
    createdAt: new Date().toISOString(),
    frame,
  };
}

function noticeMessage(frame: ServerMessageEvent, kind: ProtocolNotice["kind"]): string {
  const message = stringValue(frame.message);
  if (message) return message;
  if (kind === "image") return stringValue(frame.caption) ?? "Image received";
  if (kind === "provider_fallback_warning") {
    const provider = stringValue(frame.provider) ?? "provider";
    const from = stringValue(frame.from_key) ?? "primary";
    const to = stringValue(frame.to_key) ?? "fallback";
    return `${provider} fallback: ${from} -> ${to}`;
  }
  if (kind === "usage_warning") return "Usage budget warning";
  if (kind === "cache_warning") return "Prompt cache warning";
  return "Protocol error";
}

function toolActivityFromFrame(frame: ServerMessageEvent): StreamToolActivity | null {
  const id = stringValue(frame.tool_id);
  const name = stringValue(frame.tool_name);
  if (!id || !name) return null;

  return {
    id,
    name,
    input: frame.input,
    output: stringValue(frame.output) ?? undefined,
    is_error: frame.is_error === true,
  };
}

function requestMatches(stream: ActiveStreamDraft | null, rid: string | null): boolean {
  if (!stream) return false;
  if (!rid) return true;
  return stream.rid === rid;
}

function pendingCommandName(state: DaemonState, rid: string | null): string | null {
  return rid ? state.pendingCommands[rid]?.name ?? null : null;
}

function withoutPendingCommand(
  pending: Record<string, PendingCommand>,
  rid: string | null,
): Record<string, PendingCommand> {
  if (!rid || !pending[rid]) return pending;
  const next = { ...pending };
  delete next[rid];
  return next;
}

function isStaleRevision(state: DaemonState, revision: number | null): boolean {
  return revision !== null && state.revision > 0 && revision < state.revision;
}

function appendBounded<T>(items: T[], item: T, max: number): T[] {
  const next = [...items, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

function longest(a: string, b: string): string {
  return b.length >= a.length ? b : a;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function makeRid(prefix: string): string {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${random}`;
}
