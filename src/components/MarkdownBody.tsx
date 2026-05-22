import { memo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

interface MarkdownBodyProps {
  content: string;
  trailing?: ReactNode;
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

function MarkdownBodyImpl({ content, trailing }: MarkdownBodyProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={safeUrlTransform}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
      {trailing}
    </div>
  );
}

function safeUrlTransform(url: string): string {
  return defaultUrlTransform(url);
}

export const MarkdownBody = memo(MarkdownBodyImpl);
