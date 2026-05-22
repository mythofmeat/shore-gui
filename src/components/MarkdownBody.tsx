import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface MarkdownBodyProps {
  content: string;
  streaming?: boolean;
}

const components: Components = {
  a({ href, children, ...rest }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  },
};

function MarkdownBodyImpl({ content, streaming }: MarkdownBodyProps) {
  const className = streaming ? "markdown streaming" : "markdown";
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={safeUrlTransform}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
      {streaming && content.length === 0 && <span className="ember-cursor" />}
    </div>
  );
}

function safeUrlTransform(url: string): string {
  return defaultUrlTransform(url);
}

export const MarkdownBody = memo(MarkdownBodyImpl);
