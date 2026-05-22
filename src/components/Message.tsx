import { Sigil } from "./Sigil.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { formatTimestamp, type DisplayMessage } from "../lib/messages.ts";
import { useViewSettings } from "../hooks/useViewSettings.ts";

interface MessageProps {
  message: DisplayMessage;
  characterName: string;
}

export function Message({ message, characterName }: MessageProps) {
  const time = formatTimestamp(message.timestamp);
  const streaming = message.streaming === true;
  const { showThinking } = useViewSettings();

  if (message.role === "user") {
    return (
      <div className="msg user">
        <MarkdownBody content={message.content} />
        {time && <div className="msg-meta">{time}</div>}
      </div>
    );
  }

  if (message.role === "assistant") {
    const thinking = message.thinking ?? "";
    const renderThinking = showThinking && thinking.length > 0;
    return (
      <div className="msg char">
        <div className="name-line">
          <Sigil streaming={streaming} />
          <span className="name">{characterName}</span>
        </div>
        {renderThinking && (
          <ThinkingBlock text={thinking} streaming={streaming} />
        )}
        <div className="body">
          <MarkdownBody content={message.content} streaming={streaming} />
        </div>
        {!streaming && time && <div className="msg-meta">{time}</div>}
      </div>
    );
  }

  return (
    <div className="msg user" style={{ opacity: 0.6, fontStyle: "italic" }}>
      <MarkdownBody content={message.content} />
    </div>
  );
}

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
}

function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  return (
    <details className="thinking" open={streaming}>
      <summary>thinking</summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}
