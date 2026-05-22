import { useEffect, useState } from "react";

const PREFIX = "shore-gui:";

export interface ViewSettings {
  showThinking: boolean;
}

const DEFAULTS: ViewSettings = {
  showThinking: true,
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
    showThinking: readBool("show_thinking", DEFAULTS.showThinking),
  };
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
