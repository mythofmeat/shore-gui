import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDaemon } from "./hooks/useDaemon.ts";
import { useAssistantMessageNotifications } from "./hooks/useNotifications.ts";
import { Composer, type ComposerEdit } from "./components/Composer.tsx";
import { Message } from "./components/Message.tsx";
import { SettingsMenu } from "./components/SettingsMenu.tsx";
import { NoticeToast } from "./components/NoticeToast.tsx";
import { NoticesPanel } from "./components/NoticesPanel.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { MemorySearch } from "./components/MemorySearch.tsx";
import { InjectSystem } from "./components/InjectSystem.tsx";
import { CompactDialog } from "./components/CompactDialog.tsx";
import { CharacterPicker } from "./components/CharacterPicker.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { AltPicker } from "./components/AltPicker.tsx";
import { SamplerSettings } from "./components/SamplerSettings.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TimeGap } from "./components/TimeGap.tsx";
import { FullscreenImageViewer } from "./components/FullscreenImageViewer.tsx";
import { literaryDuration } from "./lib/messages.ts";
import { useClearMarker, isClearedSystemMessage } from "./hooks/useClearMarker.ts";
import { useImageGallery } from "./hooks/useImageGallery.ts";
import { DAEMON_COMMANDS } from "./lib/commands.ts";
import type { DisplayMessage } from "./lib/messages.ts";

const DEFAULT_CHARACTER_NAME = "Shore";
// How close to the bottom (in px) counts as "following" — auto-scroll only
// chases new content when the user is within this band.
const STICK_TO_BOTTOM_PX = 120;

export default function App() {
  const daemon = useDaemon();
  const {
    status,
    messages,
    streaming,
    lastStreamEnd,
    notices,
    latestNotice,
    commandResults,
    historyHasMoreBefore,
    loadMoreHistory,
    connect,
    cancel,
    send,
    regen,
    command,
  } = daemon;

  // Per-message edit target (#11). Holds the message being edited; null when
  // composing fresh. Send dispatches command("edit", …) instead of a normal
  // send; Cancel/Esc clears it (the Composer restores the prior draft).
  const [editTarget, setEditTarget] = useState<DisplayMessage | null>(null);

  const [noticesOpen, setNoticesOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [injectSystemOpen, setInjectSystemOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingOpen, setSettingOpen] = useState(false);
  // The alt picker (#10) and the ref (assistant msg_id) whose alternates it
  // shows. null ref = operate on the latest turn (opened from the palette).
  const [altOpen, setAltOpen] = useState(false);
  const [altRef, setAltRef] = useState<string | null>(null);
  // The most recent successful compaction, surfaced as a fold divider in the
  // stream (#13). null until a compact succeeds; dismissable.
  const [compactFold, setCompactFold] = useState<
    { id: number; keepTurns: number | null } | null
  >(null);

  // Local-only "clear system entries" marker (#16). Hides system-role messages
  // at/before the marker timestamp; reversible via the Undo affordance.
  const { marker: clearMarker, clearSystemBefore, undo: undoClear } =
    useClearMarker();

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) => !isClearedSystemMessage(m.role, m.timestamp, clearMarker),
      ),
    [messages, clearMarker],
  );
  const hiddenSystemCount = messages.length - visibleMessages.length;

  // Fullscreen image viewer: collects every renderable conversation image so
  // ArrowLeft/Right + wheel can cycle across all of them (#18).
  const gallery = useImageGallery(messages);

  const characters =
    status?.kind === "connected" ? status.characters : [];

  const selectedCharacter =
    status?.kind === "connected" ? status.selected_character : null;

  const characterName =
    status?.kind === "connected" && status.selected_character
      ? status.selected_character
      : DEFAULT_CHARACTER_NAME;

  // The CharacterInfo for the active character, used to render its avatar in the
  // assistant name-line (falls back to the Sigil when absent).
  const activeCharacter = useMemo(
    () => characters.find((c) => c.name === selectedCharacter) ?? null,
    [characters, selectedCharacter],
  );

  useAssistantMessageNotifications(lastStreamEnd, characterName);

  const connected = status?.kind === "connected";

  // Build the composer's editing handle from the current edit target. The edit
  // is dispatched as command("edit", { msg_id, text }); the daemon replies
  // asynchronously (and the revised history arrives via the reducer), so we
  // optimistically leave edit mode once the command is dispatched. Failures
  // surface through the global notice toast (an `error` frame for the rid).
  const editing: ComposerEdit | null = useMemo(() => {
    if (!editTarget) return null;
    return {
      msgId: editTarget.msg_id,
      initialText: editTarget.content,
      label: editTarget.role === "user" ? "your message" : characterName,
      onSubmit: async (text: string) => {
        await command(DAEMON_COMMANDS.edit, {
          ref: editTarget.msg_id,
          content: text,
        });
        setEditTarget(null);
      },
      onCancel: () => setEditTarget(null),
    };
  }, [editTarget, characterName, command]);

  // Per-message delete (#12). The Message action row owns the confirmation
  // step, so by the time this fires the user has already confirmed. We dispatch
  // command("delete", …) by msg_id and rely on the daemon's history update for
  // the visible result; failures surface through the global notice toast (an
  // `error` frame keyed to the rid). Send both `refs` (array, preferred) and
  // `ref` (singular) since the exact key is daemon-defined (see caveats).
  const deleteMessage = useCallback(
    (msg: DisplayMessage) => {
      void command(DAEMON_COMMANDS.delete, {
        refs: [msg.msg_id],
        ref: msg.msg_id,
      });
    },
    [command],
  );

  // Regenerate (#9) is offered only on the latest *settled* assistant turn.
  // While streaming, the live assistant draft is the last entry; once it
  // settles it becomes the regenerable target. We never offer regen mid-stream.
  const latestAssistantId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      const m = visibleMessages[i];
      if (m.role === "assistant" && m.streaming !== true) return m.msg_id;
    }
    return null;
  }, [visibleMessages]);

  const regenMessage = useCallback(
    (guidance?: string) => {
      void regen(guidance);
    },
    [regen],
  );

  // Open the alt picker (#10) for a specific assistant turn. Routed through the
  // same window event the palette uses, so there is a single open path.
  const showAlternatives = useCallback((msg: DisplayMessage) => {
    window.dispatchEvent(
      new CustomEvent("shore-gui:open-alt", { detail: { ref: msg.msg_id } }),
    );
  }, []);

  // Esc cancels an in-flight stream. Gated on !paletteOpen so the palette's own
  // (capture-phase, stopPropagation) Esc handler owns Escape while it is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        streaming &&
        !paletteOpen &&
        !memoryOpen &&
        !injectSystemOpen &&
        !compactOpen &&
        !characterOpen &&
        !modelOpen &&
        !settingOpen &&
        !altOpen
      ) {
        e.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [streaming, cancel, paletteOpen, memoryOpen, injectSystemOpen, compactOpen, characterOpen, modelOpen, settingOpen, altOpen]);

  // Ctrl/Cmd+K opens the command palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // "/" at an empty composer opens the palette (fired by the Composer).
  useEffect(() => {
    const onSlash = () => setPaletteOpen(true);
    window.addEventListener("shore-gui:open-palette", onSlash);
    return () => window.removeEventListener("shore-gui:open-palette", onSlash);
  }, []);

  // The "memory" palette command opens the dedicated memory search overlay
  // (#15). Closing the palette first avoids two stacked modals.
  useEffect(() => {
    const onOpenMemory = () => {
      setPaletteOpen(false);
      setMemoryOpen(true);
    };
    window.addEventListener("shore-gui:open-memory", onOpenMemory);
    return () => window.removeEventListener("shore-gui:open-memory", onOpenMemory);
  }, []);

  // The "inject system" palette command opens the dedicated inject-system
  // overlay (#14), which supports multiline input. Close the palette first to
  // avoid two stacked modals.
  useEffect(() => {
    const onOpenInjectSystem = () => {
      setPaletteOpen(false);
      setInjectSystemOpen(true);
    };
    window.addEventListener("shore-gui:open-inject-system", onOpenInjectSystem);
    return () =>
      window.removeEventListener("shore-gui:open-inject-system", onOpenInjectSystem);
  }, []);

  // The "compact" palette command opens the dedicated compact overlay (#13),
  // which carries the optional keep-turns input. Close the palette first to
  // avoid two stacked modals.
  useEffect(() => {
    const onOpenCompact = () => {
      setPaletteOpen(false);
      setCompactOpen(true);
    };
    window.addEventListener("shore-gui:open-compact", onOpenCompact);
    return () => window.removeEventListener("shore-gui:open-compact", onOpenCompact);
  }, []);

  // The "character" palette command opens the dedicated character picker overlay
  // (#20), which shows avatars + the current selection. Close the palette first
  // to avoid two stacked modals.
  useEffect(() => {
    const onOpenCharacter = () => {
      setPaletteOpen(false);
      setCharacterOpen(true);
    };
    window.addEventListener("shore-gui:open-character", onOpenCharacter);
    return () =>
      window.removeEventListener("shore-gui:open-character", onOpenCharacter);
  }, []);

  // The "model" palette command opens the dedicated model picker overlay (#21),
  // which carries the show-hidden toggle and reset action. Close the palette
  // first to avoid two stacked modals.
  useEffect(() => {
    const onOpenModel = () => {
      setPaletteOpen(false);
      setModelOpen(true);
    };
    window.addEventListener("shore-gui:open-model", onOpenModel);
    return () => window.removeEventListener("shore-gui:open-model", onOpenModel);
  }, []);

  // The "model settings" palette command opens the dedicated sampler settings
  // overlay (#22), which renders each key with its value + scope source and an
  // inline edit/reset. Close the palette first to avoid two stacked modals.
  useEffect(() => {
    const onOpenSetting = () => {
      setPaletteOpen(false);
      setSettingOpen(true);
    };
    window.addEventListener("shore-gui:open-setting", onOpenSetting);
    return () => window.removeEventListener("shore-gui:open-setting", onOpenSetting);
  }, []);

  // The "alternatives" palette command (and the per-message action row) open the
  // dedicated alt picker overlay (#10). The optional event detail carries the
  // assistant msg_id whose alternates to show; absent => latest turn. Close the
  // palette first to avoid two stacked modals.
  useEffect(() => {
    const onOpenAlt = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ref?: unknown } | null;
      const ref =
        detail && typeof detail.ref === "string" ? detail.ref : null;
      setPaletteOpen(false);
      setAltRef(ref);
      setAltOpen(true);
    };
    window.addEventListener("shore-gui:open-alt", onOpenAlt);
    return () => window.removeEventListener("shore-gui:open-alt", onOpenAlt);
  }, []);

  // Auto-scroll to bottom. Uses a sentinel + scrollIntoView (more robust to
  // font/layout timing than setting scrollTop). Only chases new content when
  // the user is already near the bottom — if they've scrolled up to read
  // history, don't yank them back.
  const streamRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  // History pagination (#19). When the scroller nears the top we request the
  // next older page; on prepend we restore the viewport so it does not jump.
  //
  // `pendingTopRestore` snapshots the scroll metrics taken at request time;
  // after the prepend grows scrollHeight we shift scrollTop by the delta in a
  // useLayoutEffect (before paint). `prevMsgCountRef` lets us distinguish a
  // top-prepend (older turns) from an append (new turns at the bottom).
  const pendingTopRestore = useRef<{ height: number; top: number } | null>(
    null,
  );
  const prevMsgCountRef = useRef(visibleMessages.length);

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distFromBottom < STICK_TO_BOTTOM_PX;
      // Near the top and more history exists: snapshot the offset and ask for
      // the next older page. The snapshot is consumed by the restore layout
      // effect once the prepend lands; if a request is already pending we skip.
      if (
        el.scrollTop < STICK_TO_BOTTOM_PX &&
        historyHasMoreBefore &&
        !pendingTopRestore.current
      ) {
        pendingTopRestore.current = {
          height: el.scrollHeight,
          top: el.scrollTop,
        };
        void loadMoreHistory().then((rid) => {
          // No request was dispatched (nothing more / already loading): drop
          // the snapshot so a later top-hit can retry.
          if (rid === null) pendingTopRestore.current = null;
        });
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [historyHasMoreBefore, loadMoreHistory]);

  // Restore the scroll offset after older turns are prepended, before paint, so
  // the viewport stays anchored on the same content instead of jumping to the
  // top. Only fires when the message count grew via a *prepend* (a pending top
  // restore snapshot exists); appends at the bottom are left to the sticky
  // effect. stickyRef stays false here (we're near the top), so the
  // auto-scroll-to-bottom effect early-returns and does not fight this.
  useLayoutEffect(() => {
    const el = streamRef.current;
    const snapshot = pendingTopRestore.current;
    const grew = visibleMessages.length > prevMsgCountRef.current;
    prevMsgCountRef.current = visibleMessages.length;
    if (el && snapshot && grew) {
      const delta = el.scrollHeight - snapshot.height;
      if (delta > 0) el.scrollTop = snapshot.top + delta;
      pendingTopRestore.current = null;
    }
  }, [visibleMessages.length]);

  useEffect(() => {
    if (!stickyRef.current) return;
    const scroll = () => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    };
    scroll();
    requestAnimationFrame(scroll);
    void document.fonts.ready.then(scroll);
  }, [messages, streaming]);

  // The "clear" command scrolls back to the bottom and dismisses overlays.
  useEffect(() => {
    const onClear = () => {
      setNoticesOpen(false);
      bottomRef.current?.scrollIntoView({ block: "end" });
    };
    window.addEventListener("shore-gui:clear-view", onClear);
    return () => window.removeEventListener("shore-gui:clear-view", onClear);
  }, []);

  // The "clear system entries" command hides system-role messages up to now.
  // Reversible — see the Undo banner below.
  useEffect(() => {
    const onClearSystem = () => clearSystemBefore();
    window.addEventListener("shore-gui:clear-system", onClearSystem);
    return () =>
      window.removeEventListener("shore-gui:clear-system", onClearSystem);
  }, [clearSystemBefore]);

  return (
    <>
      <SettingsMenu />
      <button
        type="button"
        className="notices-trigger"
        aria-label="Open notices"
        onClick={() => setNoticesOpen(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {notices.length > 0 && (
          <span className="notices-count" aria-hidden>
            {notices.length}
          </span>
        )}
      </button>
      <main className="stream" ref={streamRef}>
        <div className="stream-inner">
          {connected && historyHasMoreBefore && (
            <div className="history-more" role="status" aria-live="polite">
              earlier turns
            </div>
          )}
          {!connected && (
            <div className="msg user" style={{ textAlign: "center", padding: 0 }}>
              not connected —{" "}
              <button
                onClick={() => void connect()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ember)",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                retry
              </button>
            </div>
          )}
          {visibleMessages.map((m, i) => {
            const prev = visibleMessages[i - 1];
            const gap = gapBetween(prev, m);
            return (
              <Fragment key={m.msg_id}>
                {gap && <TimeGap label={gap} />}
                <Message
                  message={m}
                  characterName={characterName}
                  character={activeCharacter}
                  onImageClick={(image) => gallery.open(image)}
                  onEdit={(msg) => setEditTarget(msg)}
                  onDelete={deleteMessage}
                  onRegen={
                    m.msg_id === latestAssistantId ? regenMessage : undefined
                  }
                  onAlts={
                    m.role === "assistant" && m.streaming !== true
                      ? showAlternatives
                      : undefined
                  }
                />
              </Fragment>
            );
          })}
          {clearMarker && hiddenSystemCount > 0 && (
            <div className="clear-undo" role="status">
              <span className="clear-undo-label">
                {hiddenSystemCount === 1
                  ? "1 system entry hidden"
                  : `${hiddenSystemCount} system entries hidden`}
              </span>
              <button
                type="button"
                className="clear-undo-btn"
                onClick={() => undoClear()}
              >
                Undo
              </button>
            </div>
          )}
          {compactFold && (
            <div className="compact-fold" role="status">
              <span className="compact-fold-label">
                {compactFold.keepTurns === null
                  ? "older turns folded"
                  : `older turns folded · kept ${compactFold.keepTurns} recent ${
                      compactFold.keepTurns === 1 ? "turn" : "turns"
                    }`}
              </span>
              <button
                type="button"
                className="compact-fold-dismiss"
                aria-label="Dismiss compaction notice"
                onClick={() => setCompactFold(null)}
              >
                ×
              </button>
            </div>
          )}
          <div ref={bottomRef} aria-hidden />
        </div>
        <div className="fog-bottom" />
      </main>

      <StatusBar messages={messages} />

      <Composer
        connected={connected}
        characterName={characterName}
        onSend={send}
        editing={editing}
      />

      <NoticeToast notice={latestNotice} />
      <NoticesPanel
        notices={notices}
        open={noticesOpen}
        onClose={() => setNoticesOpen(false)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commandResults={commandResults}
        command={command}
        send={send}
        regen={regen}
        cancel={cancel}
      />
      <MemorySearch
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        commandResults={commandResults}
        command={command}
      />
      <InjectSystem
        open={injectSystemOpen}
        onClose={() => setInjectSystemOpen(false)}
        commandResults={commandResults}
        command={command}
      />
      <CompactDialog
        open={compactOpen}
        onClose={() => setCompactOpen(false)}
        commandResults={commandResults}
        command={command}
        onCompacted={(keepTurns) =>
          setCompactFold({ id: Date.now(), keepTurns })
        }
      />
      <CharacterPicker
        open={characterOpen}
        onClose={() => setCharacterOpen(false)}
        characters={characters}
        selected={selectedCharacter}
        commandResults={commandResults}
        command={command}
      />
      <ModelPicker
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        commandResults={commandResults}
        command={command}
      />
      <SamplerSettings
        open={settingOpen}
        onClose={() => setSettingOpen(false)}
        commandResults={commandResults}
        command={command}
      />
      <AltPicker
        open={altOpen}
        onClose={() => setAltOpen(false)}
        messageRef={altRef}
        commandResults={commandResults}
        command={command}
      />
      <FullscreenImageViewer
        images={gallery.images}
        index={gallery.openIndex}
        onClose={gallery.close}
        onNext={gallery.next}
        onPrev={gallery.prev}
      />
    </>
  );
}

function gapBetween(
  prev: { timestamp: string; streaming?: boolean } | undefined,
  curr: { timestamp: string; streaming?: boolean },
): string | null {
  if (!prev || !prev.timestamp || !curr.timestamp) return null;
  // Don't inject gaps against a live streaming message — its timestamp is
  // synthetic (set when streaming starts) and would create a bogus gap.
  if (prev.streaming || curr.streaming) return null;
  const a = new Date(prev.timestamp).getTime();
  const b = new Date(curr.timestamp).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return literaryDuration(b - a);
}
