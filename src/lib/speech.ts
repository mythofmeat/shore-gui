/**
 * Thin, defensive wrappers over the Web Speech APIs (#38). Both speech
 * synthesis and recognition are optional in WebKitGTK (the Linux Tauri
 * runtime), so every entry point feature-detects and degrades to a no-op rather
 * than throwing.
 */

// ---- speech synthesis (read aloud) ----------------------------------------

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Reduce markdown to something pleasant to hear: drop code, keep link text. */
export function toSpeakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " — code block — ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(text: string, onEnd?: () => void): void {
  if (!speechSupported()) {
    onEnd?.();
    return;
  }
  cancelSpeech();
  const speakable = toSpeakable(text);
  if (!speakable) {
    onEnd?.();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(speakable);
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return speechSupported() && window.speechSynthesis.speaking;
}

// ---- speech recognition (dictation) ---------------------------------------
//
// The DOM lib doesn't ship types for the (prefixed) SpeechRecognition API, so
// we declare the minimal surface we use.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionResultList {
  length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== null;
}

let active: Recognition | null = null;

/**
 * Start push-to-talk dictation. `onText` is called with interim and final
 * transcripts (the boolean marks final segments). Returns false when
 * recognition is unavailable. Call stopDictation() to end.
 */
export function startDictation(
  onText: (text: string, isFinal: boolean) => void,
  onEnd?: () => void,
): boolean {
  const Ctor = recognitionCtor();
  if (!Ctor) return false;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-US";
  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (final) onText(final, true);
    else if (interim) onText(interim, false);
  };
  rec.onend = () => {
    active = null;
    onEnd?.();
  };
  rec.onerror = () => {
    active = null;
    onEnd?.();
  };
  try {
    rec.start();
    active = rec;
    return true;
  } catch {
    active = null;
    return false;
  }
}

export function stopDictation(): void {
  try {
    active?.stop();
  } catch {
    /* already stopped */
  }
  active = null;
}
