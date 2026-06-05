import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { CodeBlock } from "./CodeBlock.tsx";

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
  img({ src, alt, ...rest }) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        {...rest}
      />
    );
  },
  // Fenced code blocks get syntax highlighting (#24). react-markdown wraps a
  // block in <pre><code class="language-x">…</code></pre>; we unwrap the <pre>
  // (CodeBlock renders its own frame) and route block code through CodeBlock.
  // Inline code never reaches the `pre` override and falls through to a plain
  // <code> below.
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const text = String(children ?? "");
    if (match) return <CodeBlock code={text} language={match[1]} />;
    // A multiline fence without a language tag is still a block.
    if (text.includes("\n")) return <CodeBlock code={text} language="" />;
    return <code className={className}>{children}</code>;
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
