import { useEffect } from "react";
import "../styles/preferences.css";
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  setUiSetting,
  useUiSettings,
  type DensityPref,
  type FontFamilyPref,
  type ReducedMotionPref,
  type ThemePref,
  type UiSettingKey,
} from "../hooks/useUiSettings.ts";

interface PreferencesProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Preferences overlay (#39) — the settings home for the whole app. Follows the
 * SamplerSettings overlay pattern (cmd-overlay / cmd-palette shell, capture-phase
 * Escape so it pre-empts the global stream-cancel handler, role=dialog). Every
 * control is bound directly to useUiSettings/setUiSetting, which persists to
 * localStorage and broadcasts so UiSettingsEffects re-applies to <html> live.
 */
export function Preferences({ open, onClose }: PreferencesProps) {
  const ui = useUiSettings();

  // Capture-phase Escape closes the overlay, stopping propagation so it beats
  // the global stream-cancel Esc handler while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const fontPct = Math.round(ui.fontScale * 100);
  const stepFont = (delta: number) => {
    const next = Math.min(
      FONT_SCALE_MAX,
      Math.max(FONT_SCALE_MIN, Math.round((ui.fontScale + delta) * 100) / 100),
    );
    setUiSetting("fontScale", next);
  };

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div
        className="cmd-palette preferences"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <span className="cmd-prompt">⚙</span>
          <span className="inject-title">Preferences</span>
        </div>

        <div className="preferences-body">
          {/* ---------- Appearance ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Appearance</div>

            <Row label="Theme" note="System follows your OS light/dark setting.">
              <Segment<ThemePref>
                value={ui.theme}
                onChange={(v) => setUiSetting("theme", v)}
                options={[
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ]}
              />
            </Row>

            <Row label="Density" note="Compact tightens the spacing between messages.">
              <Segment<DensityPref>
                value={ui.density}
                onChange={(v) => setUiSetting("density", v)}
                options={[
                  ["cozy", "Cozy"],
                  ["compact", "Compact"],
                ]}
              />
            </Row>

            <Row label="Font size">
              <div className="pref-stepper">
                <button
                  type="button"
                  className="pref-step-btn"
                  onClick={() => stepFont(-FONT_SCALE_STEP)}
                  disabled={ui.fontScale <= FONT_SCALE_MIN + 1e-6}
                  aria-label="Decrease font size"
                >
                  −
                </button>
                <span className="pref-step-value">{fontPct}%</span>
                <button
                  type="button"
                  className="pref-step-btn"
                  onClick={() => stepFont(FONT_SCALE_STEP)}
                  disabled={ui.fontScale >= FONT_SCALE_MAX - 1e-6}
                  aria-label="Increase font size"
                >
                  +
                </button>
              </div>
            </Row>

            <Row label="Font family" note="The voice the assistant's words are set in.">
              <Segment<FontFamilyPref>
                value={ui.fontFamily}
                onChange={(v) => setUiSetting("fontFamily", v)}
                options={[
                  ["default", "Default"],
                  ["sans", "Sans"],
                  ["serif", "Serif"],
                ]}
              />
            </Row>
          </section>

          {/* ---------- Motion ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Motion</div>
            <Row
              label="Reduced motion"
              note="Softens the ember glow and pulse animations."
            >
              <Segment<ReducedMotionPref>
                value={ui.reducedMotion}
                onChange={(v) => setUiSetting("reducedMotion", v)}
                options={[
                  ["system", "System"],
                  ["on", "On"],
                  ["off", "Off"],
                ]}
              />
            </Row>
          </section>

          {/* ---------- Composer ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Composer</div>
            <Toggle
              label="Spellcheck"
              note="Check spelling as you type in the composer."
              settingKey="composerSpellcheck"
              checked={ui.composerSpellcheck}
            />
          </section>

          {/* ---------- Speech ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Speech</div>
            <Toggle
              label="Auto read-aloud"
              note="Speak assistant messages aloud as they arrive."
              settingKey="autoTts"
              checked={ui.autoTts}
            />
          </section>

          {/* ---------- Privacy ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Privacy</div>
            <Toggle
              label="Link previews"
              note="Enabling this makes outbound requests to fetch metadata for URLs in messages."
              settingKey="linkPreviews"
              checked={ui.linkPreviews}
            />
          </section>

          {/* ---------- Shortcuts ---------- */}
          <section className="pref-group">
            <div className="pref-group-title">Shortcuts</div>
            <Row
              label="Summon hotkey"
              note="Global accelerator to bring the window forward, e.g. CmdOrCtrl+Shift+Space."
            >
              <input
                className="pref-hotkey"
                type="text"
                value={ui.globalHotkey}
                spellCheck={false}
                autoComplete="off"
                placeholder="CmdOrCtrl+Shift+Space"
                onChange={(e) => setUiSetting("globalHotkey", e.target.value)}
              />
            </Row>
          </section>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  note?: string;
  children: React.ReactNode;
}

function Row({ label, note, children }: RowProps) {
  return (
    <div className="pref-row">
      <div className="pref-row-text">
        <span className="pref-label">{label}</span>
        {note ? <span className="pref-note">{note}</span> : null}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  );
}

interface SegmentProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}

function Segment<T extends string>({ value, onChange, options }: SegmentProps<T>) {
  return (
    <div className="pref-segment" role="group">
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          className="pref-segment-btn"
          aria-pressed={value === val}
          onClick={() => onChange(val)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  label: string;
  note?: string;
  settingKey: UiSettingKey;
  checked: boolean;
}

function Toggle({ label, note, settingKey, checked }: ToggleProps) {
  return (
    <Row label={label} note={note}>
      <input
        type="checkbox"
        className="pref-switch"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => setUiSetting(settingKey, e.target.checked)}
      />
    </Row>
  );
}
