import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type MarkdownContentProps = {
  content?: string | null;
  empty?: ReactNode;
  className?: string;
  mode?: 'auto' | 'markdown' | 'plain';
  variant?: 'default' | 'report';
};

function joinClasses(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

function getTextFromReactNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextFromReactNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getTextFromReactNode(node.props.children);
  return '';
}

function renderReportHeadingChildren(children: ReactNode): ReactNode {
  const text = getTextFromReactNode(children);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (!match || match.index === undefined) return children;

  const before = text.slice(0, match.index);
  const date = match[0];
  const after = text.slice(match.index + date.length);

  return (
    <>
      {before}
      <span className="whitespace-nowrap">{date}</span>
      {after}
    </>
  );
}

const proseClassName = [
  'max-w-none min-w-0 break-words text-zinc-700',
  '[&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-tight [&_h1]:text-zinc-900',
  '[&_h2]:mt-8 [&_h2]:border-t [&_h2]:border-zinc-200 [&_h2]:pt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7 [&_h2]:tracking-tight [&_h2]:text-zinc-900 first:[&_h2]:mt-0',
  '[&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-6 [&_h3]:text-zinc-900',
  '[&_p]:my-3 [&_p]:break-words [&_p]:text-sm [&_p]:leading-7 [&_p]:text-zinc-700',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5',
  '[&_li]:break-words [&_li]:pl-1 [&_li]:text-sm [&_li]:leading-7 [&_li]:text-zinc-700 [&_li::marker]:text-teal-600',
  '[&_strong]:font-semibold [&_strong]:text-zinc-900 [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-zinc-800',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:bg-zinc-950 [&_pre]:px-4 [&_pre]:py-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-100',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-teal-500 [&_blockquote]:bg-teal-50/70 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-zinc-700',
  '[&_a]:text-teal-700 [&_a]:no-underline hover:[&_a]:text-teal-800',
  '[&_img]:rounded-2xl [&_img]:border [&_img]:border-zinc-200',
  '[&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:rounded-2xl [&_table]:border [&_table]:border-zinc-200',
  '[&_thead]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-[0.18em] [&_th]:text-zinc-500',
  '[&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:text-zinc-700',
].join(' ');

const reportProseClassName = [
  proseClassName,
  'prose-h1:mb-5 prose-h1:text-2xl prose-h1:leading-tight',
  'prose-h2:mt-8 prose-h2:border-t prose-h2:border-zinc-200 prose-h2:pt-5 prose-h2:text-lg prose-h2:leading-7',
  'prose-h3:mt-5 prose-h3:text-base prose-h3:leading-6 prose-h3:text-zinc-900',
  'prose-ul:my-3 prose-ul:space-y-2 prose-ol:my-3 prose-ol:space-y-2',
  'prose-li:pl-1 marker:prose-li:text-teal-600',
  'prose-hr:border-zinc-200',
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

export function MarkdownContent({ content, empty, className, mode = 'auto', variant = 'default' }: MarkdownContentProps) {
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
    <div className={joinClasses(variant === 'report' ? reportProseClassName : proseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node: _node, children, ...props }) => (
            <h1 {...props}>{variant === 'report' ? renderReportHeadingChildren(children) : children}</h1>
          ),
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
