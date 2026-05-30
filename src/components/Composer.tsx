import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { ImageUpload } from "../hooks/useDaemon.ts";
import { useUiSettings } from "../hooks/useUiSettings.ts";
import { EditDiff } from "./EditDiff.tsx";
import { MSG_DRAG_MIME, isImageFile, fileToBase64 } from "../lib/dnd.ts";
import { startDictation, stopDictation, dictationSupported } from "../lib/speech.ts";
import "../styles/dnd.css";
import "../styles/speech.css";

/**
 * Describes an in-progress per-message edit (#11). When present, the composer
 * enters "editing" mode: it shows a banner, the textarea is prefilled with the
 * message body, and Send dispatches `onSubmit` (the edit command) instead of a
 * normal send.
 */
export interface ComposerEdit {
  /** Stable key so the composer re-prefills when the target changes. */
  msgId: string;
  /** Original message body, pulled into the textarea. */
  initialText: string;
  /** Short label for the banner, e.g. "your message" / the character's name. */
  label: string;
  /** Dispatch the edit. Resolves/throws like a normal command. */
  onSubmit: (text: string) => Promise<void> | void;
  /** Restore the prior composer draft and leave editing mode. */
  onCancel: () => void;
}

interface ComposerProps {
  connected: boolean;
  characterName: string;
  onSend: (text: string, images?: ImageUpload[]) => Promise<void> | void;
  /** Active edit, or null when composing a fresh message (#11). */
  editing?: ComposerEdit | null;
}

/** A queued image attachment (#17) with a preview data: URI for the thumbnail. */
interface PendingImage {
  id: string;
  filename: string;
  /** Base64 bytes (no prefix), forwarded as ImageUpload.data. */
  data: string;
  /** data: URI used only for the local thumbnail preview. */
  preview: string;
}

let pendingImageSeq = 0;

function mimeFromFilename(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

/** Strip a "data:...;base64," prefix from a data URI, returning bare base64. */
function stripDataUri(value: string): string {
  const comma = value.indexOf(",");
  return comma >= 0 ? value.slice(comma + 1) : value;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUri(String(reader.result ?? "")));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

export function Composer({
  connected,
  characterName,
  onSend,
  editing,
}: ComposerProps) {
  const [text, setText] = useState("");
  // Native (OS/WebView) spellcheck toggle (#41). Defaults on; the toggle lives
  // in Preferences. We only consume the value here.
  const { composerSpellcheck } = useUiSettings();
  // Edit-message diff (#26): show old→new while editing; toggle to hide.
  const [showDiff, setShowDiff] = useState(true);
  // Drag-and-drop (#33): highlight while a droppable item hovers the composer.
  const [dragOver, setDragOver] = useState(false);
  // Push-to-talk dictation (#38).
  const [listening, setListening] = useState(false);
  // Queue of images attached to the NEXT message (#17). Cleared after send.
  const [images, setImages] = useState<PendingImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The fresh-compose draft, stashed while editing so Cancel (or finishing an
  // edit) restores whatever the user had typed before they started editing.
  const stashedDraft = useRef("");

  // Track edit transitions so we know when we are *entering* edit mode (to
  // stash the draft) vs *leaving* it (to restore the draft).
  const editKey = editing ? editing.msgId : null;
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      // Entering edit mode (from a fresh compose) stashes the current draft so
      // it can be restored on cancel. Switching directly between edit targets
      // keeps the already-stashed draft.
      if (!wasEditing.current) stashedDraft.current = text;
      wasEditing.current = true;
      setText(editing.initialText);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      });
    } else {
      // Leaving edit mode restores the stashed pre-edit draft.
      if (wasEditing.current) setText(stashedDraft.current);
      wasEditing.current = false;
    }
    // Only re-run when the edit target changes (keyed by msgId), not on every
    // keystroke or onSubmit identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);

  // Auto-grow the textarea to fit its content, capped by CSS max-height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Quote text into the composer (e.g. from memory search, #15). Appends to any
  // existing draft, then focuses the textarea ready to send.
  useEffect(() => {
    const onQuote = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const quoted =
        detail && typeof (detail as { text?: unknown }).text === "string"
          ? (detail as { text: string }).text
          : "";
      if (!quoted) return;
      setText((prev) => {
        const sep = prev.length > 0 && !prev.endsWith("\n") ? "\n" : "";
        return `${prev}${sep}${quoted}`;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("shore-gui:quote", onQuote);
    return () => window.removeEventListener("shore-gui:quote", onQuote);
  }, []);

  const addImage = (filename: string, data: string) => {
    if (!data) return;
    pendingImageSeq += 1;
    const preview = `data:${mimeFromFilename(filename)};base64,${data}`;
    setImages((prev) => [
      ...prev,
      { id: `img_${pendingImageSeq}`, filename, data, preview },
    ]);
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const clearImages = () => setImages([]);

  // File picker via the dialog plugin. Reads bytes -> base64 in Rust so we
  // avoid needing an fs-scope capability.
  const pickImages = async () => {
    if (!connected || editing) return;
    try {
      const selection = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
          },
        ],
      });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      for (const path of paths) {
        try {
          const read = await invoke<{ filename: string; data: string }>(
            "read_image_file",
            { path },
          );
          addImage(read.filename, read.data);
        } catch (err) {
          console.error("failed to read picked image", err);
        }
      }
    } catch (err) {
      console.error("image picker failed", err);
    }
  };

  // Clipboard paste handler: capture image blobs and queue them. Linux
  // WebKitGTK clipboard-image support is uncertain (see caveats).
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (editing) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      const ext = item.type.split("/")[1] ?? "png";
      void blobToBase64(blob)
        .then((data) => addImage(`pasted.${ext}`, data))
        .catch((err) => console.error("failed to read pasted image", err));
    }
  };

  const canSend =
    connected && (text.trim().length > 0 || (!editing && images.length > 0));

  const handleSend = async () => {
    if (!canSend) return;
    const trimmed = text.trim();
    if (editing) {
      // Dispatch the edit; the host clears editing state, which resets the
      // composer (and restores any prior draft).
      await editing.onSubmit(trimmed);
      return;
    }
    const attachments: ImageUpload[] = images.map((img) => ({
      filename: img.filename,
      data: img.data,
    }));
    await onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    clearImages();
  };

  const cancelEdit = () => {
    editing?.onCancel();
  };

  // Append quoted/dictated text to the current draft and focus the composer.
  const appendText = (addition: string, separator = "\n") => {
    if (!addition) return;
    setText((prev) => {
      const sep = prev.length > 0 && !prev.endsWith(separator) ? separator : "";
      return `${prev}${sep}${addition}`;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Drag-and-drop (#33): the composer accepts a message dragged from history
  // (quote it) and image files dropped in (queue them as attachments).
  const onDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (editing) return;
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes("Files") && !types.includes(MSG_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent<HTMLElement>) => {
    if (editing) return;
    setDragOver(false);
    const quoted = e.dataTransfer.getData(MSG_DRAG_MIME);
    if (quoted) {
      e.preventDefault();
      appendText(quoted);
      return;
    }
    const files = Array.from(e.dataTransfer.files ?? []).filter(isImageFile);
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        void fileToBase64(file)
          .then((data) => addImage(file.name || "dropped.png", data))
          .catch((err) => console.error("dropped image failed", err));
      }
    }
  };

  // Push-to-talk dictation (#38): append final transcript segments to the draft.
  const toggleDictation = () => {
    if (listening) {
      stopDictation();
      setListening(false);
      return;
    }
    const ok = startDictation(
      (segment, isFinal) => {
        if (isFinal) appendText(segment, " ");
      },
      () => setListening(false),
    );
    if (ok) setListening(true);
  };
  // Stop any in-flight dictation on unmount.
  useEffect(() => () => stopDictation(), []);

  // Tray quick-reply (#36) focuses the composer.
  useEffect(() => {
    const onFocus = () => textareaRef.current?.focus();
    window.addEventListener("shore-gui:focus-composer", onFocus);
    return () => window.removeEventListener("shore-gui:focus-composer", onFocus);
  }, []);

  const placeholder = !connected
    ? "Not connected"
    : editing
      ? `Edit ${editing.label}…`
      : `Speak to ${characterName}...`;

  return (
    <footer
      className={`composer${editing ? " composer-editing" : ""}${
        dragOver ? " composer-drop" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="input-wrap">
        {editing && (
          <div className="composer-edit-banner">
            <span className="composer-edit-label">
              Editing {editing.label}
            </span>
            <button
              type="button"
              className="composer-diff-toggle"
              onClick={() => setShowDiff((v) => !v)}
            >
              {showDiff ? "hide diff" : "show diff"}
            </button>
            <button
              type="button"
              className="composer-edit-cancel"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        )}
        {editing && showDiff && (
          <EditDiff before={editing.initialText} after={text} />
        )}
        {dragOver && (
          <div className="composer-drop-hint">drop to attach / quote…</div>
        )}
        {!editing && images.length > 0 && (
          <div className="composer-attachments">
            {images.map((img) => (
              <div key={img.id} className="composer-attachment">
                <img src={img.preview} alt={img.filename} />
                <button
                  type="button"
                  className="composer-attachment-remove"
                  aria-label={`Remove ${img.filename}`}
                  title="Remove"
                  onClick={() => removeImage(img.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="composer-attachments-clear"
              onClick={clearImages}
              title="Remove all attachments"
            >
              Clear
            </button>
          </div>
        )}
        <div className="input-row">
          <span className="input-prompt">{editing ? "✎" : "⟩"}</span>
          {!editing && (
            <button
              type="button"
              className="composer-attach-btn"
              onClick={() => void pickImages()}
              disabled={!connected}
              title="Attach image"
              aria-label="Attach image"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          )}
          {!editing && dictationSupported() && (
            <button
              type="button"
              className="composer-mic"
              data-listening={listening}
              onClick={toggleDictation}
              disabled={!connected}
              title={listening ? "Stop dictation" : "Dictate"}
              aria-label={listening ? "Stop dictation" : "Dictate"}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            // Native spellcheck + the right-click corrections / "add to
            // dictionary" menu (#41). Driven by the Preferences toggle; OS/
            // WebView handles the underlining and suggestions. Sentence-style
            // autocapitalization and autocorrect suit prose; lang hints the
            // dictionary. (WebKitGTK support varies — see report caveats.)
            spellCheck={composerSpellcheck}
            autoCapitalize="sentences"
            autoCorrect="on"
            lang="en"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              } else if (e.key === "Escape" && editing) {
                // While editing, Escape cancels the edit. Stop propagation so
                // it does not also reach the global stream-cancel listener.
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              } else if (e.key === "/" && text.length === 0 && !editing) {
                // "/" on an empty composer opens the command palette instead of
                // typing a slash. App.tsx listens for this event.
                e.preventDefault();
                window.dispatchEvent(new Event("shore-gui:open-palette"));
              }
            }}
            placeholder={placeholder}
            disabled={!connected}
          />
          <button
            className="send-btn"
            onClick={() => void handleSend()}
            disabled={!canSend}
            title={editing ? "Save edit" : "Send"}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}
