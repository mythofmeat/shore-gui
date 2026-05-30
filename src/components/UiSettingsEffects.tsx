import { useEffect } from "react";
import { useUiSettings } from "../hooks/useUiSettings.ts";

/**
 * Applies UI preferences (#39) to the document root so the token system in
 * index.css can react. Renders nothing; the integrator mounts it once near the
 * app root.
 *
 * - theme 'system' clears data-theme so the `prefers-color-scheme` media query
 *   governs; 'light'/'dark' pin it explicitly.
 * - density / fontFamily / reducedMotion become data-* attributes that index.css
 *   keys its overrides off of.
 * - fontScale is written as the --font-scale custom property (multiplied into
 *   the body font-size).
 */
export function UiSettingsEffects() {
  const { theme, density, fontFamily, reducedMotion, fontScale } = useUiSettings();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.dataset.fontFamily = fontFamily;
  }, [fontFamily]);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion === "system") {
      delete root.dataset.reducedMotion;
    } else {
      root.dataset.reducedMotion = reducedMotion;
    }
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [fontScale]);

  return null;
}
