import { Sigil } from "./Sigil.tsx";
import type { CharacterInfo } from "../hooks/useDaemon.ts";

interface AvatarProps {
  character?: CharacterInfo | null;
  /** Pixel size of the avatar square / sigil box. Defaults to 28. */
  size?: number;
  /** Forwarded to the Sigil fallback so the assistant name-line can pulse. */
  streaming?: boolean;
  className?: string;
}

/**
 * Character avatar (#20). Renders CharacterInfo.avatar as a data: URI image when
 * present, otherwise falls back to the ember Sigil. CSP is currently null so
 * data: URIs load; there is no asset/fs protocol, so we never render from a
 * bare path.
 */
export function Avatar({ character, size = 28, streaming, className }: AvatarProps) {
  const avatar = character?.avatar;
  const dimension = { width: size, height: size };

  if (avatar && avatar.data) {
    return (
      <img
        className={`avatar ${className ?? ""}`}
        style={dimension}
        src={avatarSrc(avatar)}
        alt={character?.name ?? "character avatar"}
        draggable={false}
      />
    );
  }

  return (
    <span
      className={`avatar avatar-fallback ${className ?? ""}`}
      style={dimension}
      aria-hidden
    >
      <Sigil streaming={streaming} />
    </span>
  );
}

/** Builds a data: URI for a character avatar; falls back to png if mime empty. */
export function avatarSrc(avatar: { mime_type: string; data: string }): string {
  const mime = avatar.mime_type.trim().length > 0 ? avatar.mime_type : "image/png";
  return `data:${mime};base64,${avatar.data}`;
}
