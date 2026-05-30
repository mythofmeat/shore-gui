import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUiSettings } from "../hooks/useUiSettings.ts";
import "../styles/link-preview.css";

/** Mirrors the backend `LinkPreview` struct (#40). */
interface LinkMeta {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}

// Module-level cache keyed by url. A `null` entry records a failed/empty fetch
// so we don't retry it every render. Shared across all message instances.
const cache = new Map<string, LinkMeta | null>();

/**
 * Link unfurl card (#40). PRIVACY: rendering is gated on the opt-in
 * `linkPreviews` setting (off by default) — only then do we ask the backend's
 * `fetch_link_preview` command to fetch + scrape the URL server-side (no CORS,
 * and the bare link already stands if this renders nothing). Each card has a
 * per-link dismiss so a user can hide a noisy or sensitive unfurl.
 */
export function LinkPreview({ url }: { url: string }) {
  const { linkPreviews } = useUiSettings();
  const [meta, setMeta] = useState<LinkMeta | null | undefined>(() => cache.get(url));
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!linkPreviews || hidden) return;
    if (cache.has(url)) {
      setMeta(cache.get(url) ?? null);
      return;
    }
    let cancelled = false;
    void invoke<LinkMeta>("fetch_link_preview", { url })
      .then((m) => {
        cache.set(url, m);
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        cache.set(url, null);
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, linkPreviews, hidden]);

  if (!linkPreviews || hidden || !meta) return null;
  // Nothing worth showing → let the bare link in the body stand alone.
  if (!meta.title && !meta.description && !meta.image) return null;

  return (
    <a
      className="link-card"
      href={meta.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {meta.image ? (
        <img
          className="link-card-thumb"
          src={meta.image}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <span className="link-card-body">
        {meta.site_name ? (
          <span className="link-card-site">{meta.site_name}</span>
        ) : null}
        {meta.title ? <span className="link-card-title">{meta.title}</span> : null}
        {meta.description ? (
          <span className="link-card-desc">{meta.description}</span>
        ) : null}
      </span>
      <button
        type="button"
        className="link-card-hide"
        aria-label="Hide preview"
        title="Hide preview"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setHidden(true);
        }}
      >
        ×
      </button>
    </a>
  );
}

const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,!?]/g;

/** Extract up to `max` distinct bare URLs from message text for unfurling. */
export function extractUrls(text: string, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}
