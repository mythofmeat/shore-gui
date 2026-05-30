import { useCallback, useMemo, useState } from "react";
import type { DisplayMessage, ImageRef } from "../lib/messages.ts";

/** An image that is actually renderable (carries base64 `data`). */
export interface GalleryImage {
  path: string;
  caption: string | null;
  data: string;
}

export interface ImageGalleryController {
  /** All renderable conversation images, in message/append order. */
  images: GalleryImage[];
  /** Index into `images` of the currently-open image, or null when closed. */
  openIndex: number | null;
  /** Open the viewer at the image matching `ref` (by data, falling back to path). */
  open: (ref: ImageRef) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
}

function isRenderable(image: ImageRef): image is ImageRef & { data: string } {
  return typeof image.data === "string" && image.data.length > 0;
}

/**
 * Collects every renderable image across the conversation (in display order) so
 * the fullscreen viewer can cycle through all of them. Clicking an inline image
 * resolves to its position in this ordered list by matching base64 `data`
 * (falling back to `path`), so the viewer opens on the right image regardless of
 * which message it came from.
 */
export function useImageGallery(messages: DisplayMessage[]): ImageGalleryController {
  const images = useMemo<GalleryImage[]>(() => {
    const collected: GalleryImage[] = [];
    for (const message of messages) {
      for (const image of message.images ?? []) {
        if (!isRenderable(image)) continue;
        collected.push({
          path: image.path,
          caption: image.caption ?? null,
          data: image.data,
        });
      }
    }
    return collected;
  }, [messages]);

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const open = useCallback(
    (ref: ImageRef) => {
      if (!isRenderable(ref)) return;
      let index = images.findIndex((img) => img.data === ref.data);
      if (index < 0 && ref.path) {
        index = images.findIndex((img) => img.path === ref.path);
      }
      setOpenIndex(index >= 0 ? index : null);
    },
    [images],
  );

  const close = useCallback(() => setOpenIndex(null), []);

  const next = useCallback(() => {
    setOpenIndex((current) => {
      if (current === null || images.length === 0) return current;
      return (current + 1) % images.length;
    });
  }, [images.length]);

  const prev = useCallback(() => {
    setOpenIndex((current) => {
      if (current === null || images.length === 0) return current;
      return (current - 1 + images.length) % images.length;
    });
  }, [images.length]);

  // If the open image scrolls out of the (bounded) collection, clamp/close.
  const clampedIndex =
    openIndex !== null && openIndex < images.length ? openIndex : null;

  return { images, openIndex: clampedIndex, open, close, next, prev };
}
