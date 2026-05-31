import { useEffect } from "react";
import type { GalleryImage } from "../hooks/useImageGallery.ts";

interface FullscreenImageViewerProps {
  images: GalleryImage[];
  index: number | null;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

/**
 * Fullscreen lightbox over the conversation's images. ArrowLeft/Right and the
 * mouse wheel cycle; Esc closes. Key handling runs in the capture phase and
 * stops propagation so Esc closes the viewer WITHOUT also cancelling a live
 * stream (App's stream-cancel listener is a bubble-phase window handler).
 */
export function FullscreenImageViewer({
  images,
  index,
  onClose,
  onNext,
  onPrev,
}: FullscreenImageViewerProps) {
  const open = index !== null && index >= 0 && index < images.length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        onPrev();
      }
    };
    // Capture phase so we win over App's window keydown listeners.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose, onNext, onPrev]);

  if (!open) return null;

  const image = images[index];
  const multiple = images.length > 1;

  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY > 0 || e.deltaX > 0) onNext();
    else if (e.deltaY < 0 || e.deltaX < 0) onPrev();
  };

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      onWheel={onWheel}
    >
      <button
        type="button"
        className="image-viewer-close"
        aria-label="Close image viewer"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>

      {multiple && (
        <button
          type="button"
          className="image-viewer-nav image-viewer-prev"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        >
          ‹
        </button>
      )}

      <figure
        className="image-viewer-figure"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={toDataUri(image.data)}
          alt={image.caption ?? "image"}
          className="image-viewer-img"
        />
        {image.caption && (
          <figcaption className="image-viewer-caption">
            {image.caption}
          </figcaption>
        )}
        {multiple && (
          <div className="image-viewer-counter" aria-hidden>
            {index + 1} / {images.length}
          </div>
        )}
      </figure>

      {multiple && (
        <button
          type="button"
          className="image-viewer-nav image-viewer-next"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

function toDataUri(data: string): string {
  if (data.startsWith("data:")) return data;
  return `data:${detectMime(data)};base64,${data}`;
}

function detectMime(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  return "image/png";
}
