import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type MarkdownContentProps = {
  content?: string | null;
  empty?: ReactNode;
  className?: string;
  mode?: 'auto' | 'markdown' | 'plain';
  variant?: 'default' | 'reader' | 'report';
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

function headingIdFromText(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized ? `report-${normalized}` : '';
}

function getReportParagraphTone(text: string): string | null {
  if (/^(今日判断|封面判断|结论|我的判断|为什么重要|阅读建议|下一步|建议动作)[:：]/.test(text)) return 'insight';
  if (/^(发生了什么|关键证据|证据|重点文章|对应重点文章|相关链接)[:：]/.test(text)) return 'evidence';
  if (/^(当前补充材料|素材缺口|风险|分歧|噪声|不足)[:：]/.test(text)) return 'caution';
  return null;
}

const proseClassName = [
  'max-w-none min-w-0 break-words text-zinc-700',
  '[&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-normal [&_h1]:text-zinc-900',
  '[&_h2]:mt-8 [&_h2]:border-t [&_h2]:border-zinc-200 [&_h2]:pt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7 [&_h2]:tracking-normal [&_h2]:text-zinc-900 first:[&_h2]:mt-0',
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
  '[&_thead]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-normal [&_th]:text-zinc-500',
  '[&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:text-zinc-700',
].join(' ');

const reportProseClassName = [
  proseClassName,
  '[&_h1]:mb-8 [&_h1]:text-3xl [&_h1]:leading-tight [&_h1]:text-zinc-950',
  '[&_h2]:mt-14 [&_h2]:scroll-mt-24 [&_h2]:border-t [&_h2]:border-zinc-300 [&_h2]:pt-7 [&_h2]:text-2xl [&_h2]:leading-9 first:[&_h2]:mt-0',
  '[&_h3]:mt-9 [&_h3]:scroll-mt-24 [&_h3]:border-l-2 [&_h3]:border-teal-500 [&_h3]:pl-4 [&_h3]:text-[18px] [&_h3]:leading-8 [&_h3]:text-zinc-950',
  '[&_p]:my-5 [&_p]:text-[17px] [&_p]:leading-[1.95] [&_p]:text-zinc-800',
  '[&_ul]:my-5 [&_ul]:space-y-3 [&_ol]:my-5 [&_ol]:space-y-3',
  '[&_li]:text-[16px] [&_li]:leading-[1.85] [&_li]:text-zinc-800',
  '[&_a]:font-medium [&_a]:text-teal-700 [&_a]:underline [&_a]:decoration-teal-200 [&_a]:underline-offset-4 hover:[&_a]:text-teal-900',
  '[&_strong]:font-semibold [&_strong]:text-zinc-950',
  '[&_blockquote]:my-7 [&_blockquote]:border-teal-500 [&_blockquote]:bg-teal-50/50 [&_blockquote]:py-3',
  '[&_hr]:border-zinc-200',
].join(' ');

const readerProseClassName = [
  proseClassName,
  '[font-family:var(--reader-font-family,inherit)]',
  '[&_h1]:text-[28px] [&_h1]:leading-tight',
  '[&_h2]:mt-10 [&_h2]:text-[22px] [&_h2]:leading-8 [&_h3]:mt-7 [&_h3]:text-[19px] [&_h3]:leading-8',
  '[&_p]:my-5 [&_p]:text-[length:var(--reader-font-size,17px)] [&_p]:leading-[var(--reader-line-height,1.9)] [&_p]:text-zinc-800',
  '[&_li]:text-[length:var(--reader-font-size,17px)] [&_li]:leading-[var(--reader-line-height,1.9)] [&_li]:text-zinc-800',
  '[&_blockquote]:my-6 [&_blockquote]:rounded-r-2xl [&_blockquote]:py-3',
  '[&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words',
  '[&_img]:my-7 [&_img]:mx-auto [&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:max-h-[70vh] [&_img]:bg-zinc-50 [&_img]:object-contain',
].join(' ');

const plainTextClassName = [
  'min-w-0 whitespace-pre-wrap text-[length:var(--reader-font-size,17px)] leading-[var(--reader-line-height,1.9)] text-zinc-800 [font-family:var(--reader-font-family,inherit)]',
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

export function normalizeMarkdownImages(input: string): string {
  return input.replace(
    /!\[\]\s*\(\s*(https?:\/\/[^\s)]+)(\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
    '![图片]($1$2)',
  );
}

export function looksLikeMarkdown(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/!\[[^\]]*\]\s*\(\s*https?:\/\/[^\s)]+(?:\s+['"][^'"]*['"])?\s*\)/.test(value)) return true;
  if (/(^|[^!])\[[^\]]+\]\(\s*(?:https?:\/\/|\/)[^\s)]+(?:\s+['"][^'"]*['"])?\s*\)/m.test(value)) return true;
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

  const normalizedMarkdown = normalizeMarkdownImages(value);
  const normalizedPlainText = normalizePlainText(normalizedMarkdown);
  const shouldRenderAsMarkdown = mode === 'markdown' || (mode === 'auto' && looksLikeMarkdown(normalizedMarkdown));

  if (!shouldRenderAsMarkdown) {
    return (
      <div className={joinClasses(plainTextClassName, className)}>
        {normalizedPlainText}
      </div>
    );
  }

  return (
    <div className={joinClasses(variant === 'report' ? reportProseClassName : variant === 'reader' ? readerProseClassName : proseClassName, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node: _node, children, ...props }) => (
            <h1 {...props}>{variant === 'report' ? renderReportHeadingChildren(children) : children}</h1>
          ),
          h2: ({ node: _node, children, ...props }) => {
            const id = variant === 'report' ? headingIdFromText(getTextFromReactNode(children)) : undefined;
            return <h2 {...props} id={id}>{children}</h2>;
          },
          h3: ({ node: _node, children, ...props }) => {
            const id = variant === 'report' ? headingIdFromText(getTextFromReactNode(children)) : undefined;
            return <h3 {...props} id={id}>{children}</h3>;
          },
          p: ({ node: _node, children, ...props }) => {
            const text = getTextFromReactNode(children).trim();
            // Filter machine scoring text in report mode
            if (variant === 'report' && /^(?:score\s*[><=!]+\s*[\d.]+|threshold|relevance_score)/i.test(text)) {
              return null;
            }
            const tone = variant === 'report' ? getReportParagraphTone(text) : null;
            if (!tone) return <p {...props}>{children}</p>;
            const barColor = tone === 'insight'
              ? 'bg-teal-500'
              : tone === 'evidence'
                ? 'bg-blue-500'
                : 'bg-amber-500';
            const toneBg = tone === 'insight'
              ? 'bg-teal-50/50'
              : tone === 'evidence'
                ? 'bg-blue-50/40'
                : 'bg-amber-50/50';
            return (
              <p {...props} className={joinClasses('relative rounded-xl pl-5 pr-4 py-3', toneBg)}>
                <span className={joinClasses('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', barColor)} aria-hidden="true" />
                {children}
              </p>
            );
          },
          a: ({ node: _node, children, href, ...props }) => {
            const linkText = getTextFromReactNode(children).trim();
            // In report mode, replace bare URL text with readable domain label
            if (variant === 'report' && href && /^https?:\/\//i.test(linkText)) {
              let label: string;
              try {
                label = new URL(linkText).hostname.replace(/^www\./, '');
              } catch {
                label = '查看原文';
              }
              return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
            }
            return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
          img: ({ node: _node, src, alt, title }) => (
            <img
              src={src || ''}
              alt={alt || ''}
              title={title}
              loading={variant === 'reader' ? 'eager' : 'lazy'}
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ),
          code: ({ node: _node, className: codeClassName, children, ...props }) => {
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
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
