import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type MarkdownContentProps = {
  content?: string | null;
  empty?: ReactNode;
  className?: string;
  mode?: 'auto' | 'markdown' | 'plain';
};

function joinClasses(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

const proseClassName = [
  'prose prose-zinc max-w-none break-words',
  'prose-headings:tracking-tight prose-headings:text-zinc-900',
  'prose-p:text-sm prose-p:leading-7 prose-p:text-zinc-700 prose-p:break-words',
  'prose-li:text-sm prose-li:leading-7 prose-li:text-zinc-700 prose-li:break-words',
  'prose-strong:text-zinc-900 prose-code:text-[13px] prose-code:before:hidden prose-code:after:hidden',
  'prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-pre:border prose-pre:border-zinc-200 prose-pre:bg-zinc-950 prose-pre:px-4 prose-pre:py-3',
  'prose-blockquote:border-l-4 prose-blockquote:border-teal-500 prose-blockquote:bg-teal-50/70 prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:text-zinc-700',
  'prose-a:text-teal-700 prose-a:no-underline hover:prose-a:text-teal-800',
  'prose-img:rounded-2xl prose-img:border prose-img:border-zinc-200',
  'prose-table:block prose-table:w-full prose-table:overflow-x-auto prose-table:rounded-2xl prose-table:border prose-table:border-zinc-200',
  'prose-thead:bg-zinc-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:uppercase prose-th:tracking-[0.18em] prose-th:text-zinc-500',
  'prose-td:px-3 prose-td:py-2 prose-td:text-sm prose-td:text-zinc-700',
].join(' ');

const plainTextClassName = [
  'min-w-0 whitespace-pre-wrap text-[15px] leading-8 text-zinc-700',
  'break-words [overflow-wrap:anywhere]',
].join(' ');

function stripSingleFenceWrapper(input: string): string {
  const fenced = input.match(/^```(?:[\w-]+)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const tildeFenced = input.match(/^~~~(?:[\w-]+)?\s*\n?([\s\S]*?)\n?~~~$/i);
  if (tildeFenced?.[1]?.trim()) return tildeFenced[1].trim();
  return input;
}

function normalizePlainText(input: string): string {
  return stripSingleFenceWrapper(input)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeMarkdown(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/^```[\s\S]*```$/m.test(value) || /^~~~[\s\S]*~~~$/m.test(value)) return true;
  if ((value.match(/(^|\n)#{1,6}\s+\S/g) || []).length >= 2) return true;
  if ((value.match(/(^|\n)\s*>\s+\S/g) || []).length >= 2) return true;
  if (/^\|.+\|\s*\n\|[\s:-]+\|/m.test(value)) return true;
  if ((value.match(/(^|\n)\s*(?:[-*+]\s+\S|\d+\.\s+\S)/g) || []).length >= 3) return true;
  return false;
}

export function MarkdownContent({ content, empty, className, mode = 'auto' }: MarkdownContentProps) {
  const value = (content || '').trim();
  if (!value) {
    return (
      <div className={joinClasses('rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-6 text-sm text-zinc-400', className)}>
        {empty || '暂无内容'}
      </div>
    );
  }

  const normalizedPlainText = normalizePlainText(value);
  const shouldRenderAsMarkdown = mode === 'markdown' || (mode === 'auto' && looksLikeMarkdown(value));

  if (!shouldRenderAsMarkdown) {
    return (
      <div className={joinClasses(plainTextClassName, className)}>
        {normalizedPlainText}
      </div>
    );
  }

  return (
    <div className={joinClasses(proseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          code: ({ className: codeClassName, children, ...props }) => {
            const text = String(children ?? '').replace(/\n$/, '');
            const isBlock = Boolean(codeClassName);
            if (!isBlock) {
              return (
                <code
                  {...props}
                  className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-zinc-800"
                >
                  {text}
                </code>
              );
            }
            return (
              <code {...props} className={joinClasses(codeClassName, 'font-mono text-[13px] text-zinc-100')}>
                {text}
              </code>
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
