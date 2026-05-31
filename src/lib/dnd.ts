/**
 * Drag-and-drop helpers (#33). Shared mime constant for dragging a message into
 * the composer, plus a File→base64 reader matching the composer's paste path.
 */

/** Custom mime carrying a quoted message's text when dragging it to compose. */
export const MSG_DRAG_MIME = "application/x-shore-msg";

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Read a File to bare base64 (no data: prefix), like the composer paste path. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
