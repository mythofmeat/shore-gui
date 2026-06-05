import { useEffect, useState } from "react";

const PREFIX = "shore-gui:";

/**
 * Shared UI preferences for the whole app (theming #39 + the milestone's
 * settings home). Mirrors useViewSettings.ts: values live in localStorage under
 * the "shore-gui:" prefix, writes go through setUiSetting() which dispatches a
 * synthetic "shore-gui:ui-settings" event so same-tab listeners refresh (the
 * native StorageEvent only fires in other tabs), and useUiSettings() is the
 * reader.
 *
 * DOWNSTREAM FEATURES import these exact key names — keep them stable.
 */

export type ThemePref = "system" | "light" | "dark";
export type DensityPref = "cozy" | "compact";
export type FontFamilyPref = "default" | "sans" | "serif";
export type ReducedMotionPref = "system" | "on" | "off";

export interface UiSettings {
  theme: ThemePref;
  density: DensityPref;
  fontScale: number;
  fontFamily: FontFamilyPref;
  reducedMotion: ReducedMotionPref;
  composerSpellcheck: boolean;
  autoTts: boolean;
  linkPreviews: boolean;
  globalHotkey: string;
}

export type UiSettingKey = keyof UiSettings;
export type UiSettingValue = string | number | boolean;

export const UI_SETTING_DEFAULTS: UiSettings = {
  theme: "system",
  density: "cozy",
  fontScale: 1,
  fontFamily: "default",
  reducedMotion: "system",
  composerSpellcheck: true,
  autoTts: false,
  // Privacy: OFF by default — enabling it issues outbound requests to fetch
  // URL metadata.
  linkPreviews: false,
  globalHotkey: "CmdOrCtrl+Shift+Space",
};

/** Sensible clamp for the body font scale, shared with the Preferences UI. */
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.35;
export const FONT_SCALE_STEP = 0.05;

// Maps the camelCase setting keys to their localStorage suffix.
const STORAGE_KEYS: Record<UiSettingKey, string> = {
  theme: "ui_theme",
  density: "ui_density",
  fontScale: "ui_font_scale",
  fontFamily: "ui_font_family",
  reducedMotion: "ui_reduced_motion",
  composerSpellcheck: "ui_composer_spellcheck",
  autoTts: "ui_auto_tts",
  linkPreviews: "ui_link_previews",
  globalHotkey: "ui_global_hotkey",
};

function readRaw(key: UiSettingKey): string | null {
  try {
    return localStorage.getItem(PREFIX + STORAGE_KEYS[key]);
  } catch {
    return null;
  }
}

function readString<T extends string>(key: UiSettingKey, allowed: readonly T[], fallback: T): T {
  const raw = readRaw(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function readBool(key: UiSettingKey, fallback: boolean): boolean {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  return raw === "true" || raw === "1";
}

function readNumber(key: UiSettingKey, fallback: number, min: number, max: number): number {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readAll(): UiSettings {
  return {
    theme: readString("theme", ["system", "light", "dark"], UI_SETTING_DEFAULTS.theme),
    density: readString("density", ["cozy", "compact"], UI_SETTING_DEFAULTS.density),
    fontScale: readNumber("fontScale", UI_SETTING_DEFAULTS.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX),
    fontFamily: readString(
      "fontFamily",
      ["default", "sans", "serif"],
      UI_SETTING_DEFAULTS.fontFamily,
    ),
    reducedMotion: readString(
      "reducedMotion",
      ["system", "on", "off"],
      UI_SETTING_DEFAULTS.reducedMotion,
    ),
    composerSpellcheck: readBool("composerSpellcheck", UI_SETTING_DEFAULTS.composerSpellcheck),
    autoTts: readBool("autoTts", UI_SETTING_DEFAULTS.autoTts),
    linkPreviews: readBool("linkPreviews", UI_SETTING_DEFAULTS.linkPreviews),
    globalHotkey: (() => {
      const raw = readRaw("globalHotkey");
      return raw !== null && raw.trim() ? raw : UI_SETTING_DEFAULTS.globalHotkey;
    })(),
  };
}

/**
 * Persist a UI setting and notify same-tab listeners. Generic in the value so
 * callers can pass string | number | boolean for the matching key.
 */
export function setUiSetting(key: UiSettingKey, value: UiSettingValue): void {
  try {
    localStorage.setItem(PREFIX + STORAGE_KEYS[key], String(value));
  } catch {
    // Ignore storage failures (private mode, quota); still notify in-memory.
  }
  window.dispatchEvent(new Event("shore-gui:ui-settings"));
}

export function useUiSettings(): UiSettings {
  const [settings, setSettings] = useState<UiSettings>(readAll);

  useEffect(() => {
    const refresh = () => setSettings(readAll());
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(PREFIX)) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("shore-gui:ui-settings", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("shore-gui:ui-settings", refresh);
    };
  }, []);

  return settings;
}
