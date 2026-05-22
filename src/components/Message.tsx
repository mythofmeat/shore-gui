import { Sigil } from "./Sigil.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { formatTimestamp, type DisplayMessage } from "../lib/messages.ts";

interface MessageProps {
  message: DisplayMessage;
  characterName: string;
}

export function Message({ message, characterName }: MessageProps) {
  const time = formatTimestamp(message.timestamp);
  const streaming = message.streaming === true;

  if (message.role === "user") {
    return (
      <div className="msg user">
        <MarkdownBody content={message.content} />
        {time && <div className="msg-meta">{time}</div>}
      </div>
    );
  }

  if (message.role === "assistant") {
    return (
      <div className="msg char">
        <div className="name-line">
          <Sigil streaming={streaming} />
          <span className="name">{characterName}</span>
        </div>
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
