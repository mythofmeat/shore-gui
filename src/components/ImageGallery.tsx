import type { ImageRef } from "../lib/messages.ts";

interface ImageGalleryProps {
  images: ImageRef[];
  onImageClick?: (image: ImageRef, index: number) => void;
}

/**
 * Renders inline images from base64 `data` as data: URIs. Refs without `data`
 * are skipped, since no asset/fs protocol is configured to load path-only refs.
 */
export function ImageGallery({ images, onImageClick }: ImageGalleryProps) {
  const renderable = images.filter(
    (image): image is ImageRef & { data: string } =>
      typeof image.data === "string" && image.data.length > 0,
  );

  if (renderable.length === 0) return null;

  return (
    <div className="image-gallery">
      {renderable.map((image, index) => {
        const caption = image.caption ?? undefined;
        return (
          <figure className="inline-image" key={`${image.path}:${index}`}>
            <img
              src={toDataUri(image.data)}
              alt={caption ?? "image"}
              onClick={
                onImageClick ? () => onImageClick(image, index) : undefined
              }
            />
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        );
      })}
    </div>
  );
}

function toDataUri(data: string): string {
  // Already a full data URI (e.g. produced upstream).
  if (data.startsWith("data:")) return data;
  return `data:${detectMime(data)};base64,${data}`;
}

function detectMime(base64: string): string {
  // Sniff common image signatures from the leading base64 characters.
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  return "image/png";
}
