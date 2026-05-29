import { useEffect, useState } from "react";

const PREFIX = "shore-gui:";

export interface ViewSettings {
  showTimestamps: boolean;
  showThinking: boolean;
  showTools: boolean;
  showImages: boolean;
  showMetadata: boolean;
}

export type ViewSettingKey = keyof ViewSettings;

const DEFAULTS: ViewSettings = {
  showTimestamps: true,
  showThinking: true,
  showTools: true,
  showImages: true,
  showMetadata: true,
};

// Maps the camelCase setting keys to their localStorage suffix.
const STORAGE_KEYS: Record<ViewSettingKey, string> = {
  showTimestamps: "show_timestamps",
  showThinking: "show_thinking",
  showTools: "show_tools",
  showImages: "show_images",
  showMetadata: "show_metadata",
};

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return raw === "true" || raw === "1";
  } catch {
    return fallback;
  }
}

function readAll(): ViewSettings {
  return {
    showTimestamps: readBool(STORAGE_KEYS.showTimestamps, DEFAULTS.showTimestamps),
    showThinking: readBool(STORAGE_KEYS.showThinking, DEFAULTS.showThinking),
    showTools: readBool(STORAGE_KEYS.showTools, DEFAULTS.showTools),
    showImages: readBool(STORAGE_KEYS.showImages, DEFAULTS.showImages),
    showMetadata: readBool(STORAGE_KEYS.showMetadata, DEFAULTS.showMetadata),
  };
}

/**
 * Persist a view setting and notify same-tab listeners. The StorageEvent only
 * fires in other tabs, so we dispatch a synthetic event for the current tab.
 */
export function setViewSetting(key: ViewSettingKey, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + STORAGE_KEYS[key], String(value));
  } catch {
    // Ignore storage failures (private mode, quota); still notify in-memory.
  }
  window.dispatchEvent(new Event("shore-gui:view-settings"));
}

export function useViewSettings(): ViewSettings {
  const [settings, setSettings] = useState<ViewSettings>(readAll);

  useEffect(() => {
    const refresh = () => setSettings(readAll());
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(PREFIX)) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("shore-gui:view-settings", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("shore-gui:view-settings", refresh);
    };
  }, []);

  return settings;
}
