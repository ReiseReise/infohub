function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

function sanitizeHtml(input: string): string {
  let output = input;
  output = output.replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  output = output.replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*\/?\s*>/gi, '');
  output = output.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
  output = output.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  output = output.replace(/\s(href|src)\s*=\s*(['"])javascript:[\s\S]*?\2/gi, ' $1="#"');
  return output;
}

export function renderMarkdown(input: string): string {
  const escaped = escapeHtml(input);

  const withBlocks = escaped
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const paragraphs = withBlocks
    .split(/\n{2,}/)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return '';
      if (/^<h[1-3]>/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .filter(Boolean)
    .join('');

  return paragraphs;
}

export function renderRichContent(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (HTML_TAG_PATTERN.test(trimmed)) {
    return sanitizeHtml(trimmed);
  }
  return renderMarkdown(trimmed);
}
