import { useEffect, useState } from "react";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import "../styles/code-block.css";

/**
 * Syntax-highlighted fenced code block (#24). Rendered by MarkdownBody's `code`
 * override for block (non-inline) code. Highlighting is done by
 * prism-react-renderer — no eval, colors driven by the JS theme objects below.
 *
 * The two themes (ember dark / parchment light) mirror the app's CSS tokens in
 * spirit; we pick one from the effective `data-theme` (resolving "system" via
 * the OS media query) so the block matches the surrounding UI and re-themes
 * live when the theme toggles.
 *
 * Streaming-safe: `code` can be partial mid-stream; Prism tolerates incomplete
 * source and re-highlights on each content change.
 */

interface CodeBlockProps {
  code: string;
  language: string;
}

// Languages we want covered. prism-react-renderer bundles a broad common set;
// these are the fences we explicitly normalize / support.
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  js: "javascript",
  jsx: "jsx",
  javascript: "javascript",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  bash: "bash",
  json: "json",
  jsonc: "json",
  sql: "sql",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  html: "markup",
  xml: "markup",
  markup: "markup",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  diff: "diff",
};

function normalizeLanguage(raw: string): string {
  const key = raw.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key ?? "text";
}

/** Resolve the effective theme: explicit data-theme, else the OS preference. */
function useIsLightTheme(): boolean {
  const compute = () => {
    if (typeof document === "undefined") return false;
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light") return true;
    if (attr === "dark") return false;
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: light)").matches === true
    );
  };

  const [light, setLight] = useState(compute);

  useEffect(() => {
    const update = () => setLight(compute());
    update();
    // React to live theme pin changes (data-theme attribute) …
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    // … and to OS changes when on "system".
    const mql = window.matchMedia?.("(prefers-color-scheme: light)");
    mql?.addEventListener?.("change", update);
    return () => {
      observer.disconnect();
      mql?.removeEventListener?.("change", update);
    };
  }, []);

  return light;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const lang = normalizeLanguage(language);
  const isLight = useIsLightTheme();
  const theme = isLight ? lightTheme : darkTheme;
  const [copied, setCopied] = useState(false);

  // Drop a single trailing newline react-markdown commonly appends.
  const source = code.replace(/\n$/, "");

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(source)
      .then(() => setCopied(true))
      .catch(() => {
        /* clipboard denied — leave the button quiet rather than error loudly */
      });
  };

  return (
    <div className="code-block">
      <div className="code-block-chrome">
        {language ? (
          <span className="code-block-lang">{language}</span>
        ) : null}
        <button
          type="button"
          className={copied ? "code-block-copy copied" : "code-block-copy"}
          onClick={onCopy}
          aria-label="Copy code"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <Highlight theme={theme} code={source} language={lang}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={`code-block-pre ${className}`} style={style}>
            {tokens.map((line, i) => (
              // eslint-disable-next-line react/jsx-key
              <span {...getLineProps({ line, key: i })} className="code-block-line">
                {line.map((token, key) => (
                  // eslint-disable-next-line react/jsx-key
                  <span {...getTokenProps({ token, key })} />
                ))}
              </span>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

/* ---------- ember dark theme ----------
   Warm, restrained palette tuned to the dark token set (--bg-elev #2a221d,
   --ink #f0e8de, --ember #ee8a3a). Background is transparent so the CSS frame
   (themed off --bg-elev) shows through. */
const darkTheme: PrismTheme = {
  plain: { color: "#dcd2c7", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#857866", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#a89c8c" } },
    { types: ["namespace"], style: { opacity: 0.7 } },
    { types: ["property", "tag", "boolean", "number", "constant", "symbol"], style: { color: "#ee8a3a" } },
    { types: ["selector", "attr-name", "string", "char", "builtin", "inserted"], style: { color: "#cbb98a" } },
    { types: ["operator", "entity", "url"], style: { color: "#d8a86a" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#e89a5a" } },
    { types: ["function", "class-name"], style: { color: "#f0c98a" } },
    { types: ["regex", "important", "variable"], style: { color: "#d8a86a" } },
    { types: ["deleted"], style: { color: "#d05020" } },
    { types: ["inserted"], style: { color: "#8fae6a" } },
    { types: ["important", "bold"], style: { fontWeight: "bold" } },
    { types: ["italic"], style: { fontStyle: "italic" } },
  ],
};

/* ---------- parchment light theme ----------
   Tuned to the light token set (--bg-elev #ece1cd, --ink #2c2118,
   --ember #c75d18) — deeper, warmer hues for contrast on cream. */
const lightTheme: PrismTheme = {
  plain: { color: "#3a2d20", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#9a8466", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#6c5a44" } },
    { types: ["namespace"], style: { opacity: 0.7 } },
    { types: ["property", "tag", "boolean", "number", "constant", "symbol"], style: { color: "#c75d18" } },
    { types: ["selector", "attr-name", "string", "char", "builtin", "inserted"], style: { color: "#7a6118" } },
    { types: ["operator", "entity", "url"], style: { color: "#a8420f" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#b14b12" } },
    { types: ["function", "class-name"], style: { color: "#8a5012" } },
    { types: ["regex", "important", "variable"], style: { color: "#a8420f" } },
    { types: ["deleted"], style: { color: "#a8420f" } },
    { types: ["inserted"], style: { color: "#4f6b2a" } },
    { types: ["important", "bold"], style: { fontWeight: "bold" } },
    { types: ["italic"], style: { fontStyle: "italic" } },
  ],
};
