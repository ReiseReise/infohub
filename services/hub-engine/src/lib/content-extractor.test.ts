import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanArticleBody,
  extractReadabilityArticleFromHtml,
  fetchHtmlDocumentWithFallback,
  htmlFragmentToMarkdown,
  plainTextLength,
} from './content-extractor.js';

function createMockHtmlResponse(status: number, html: string, url: string) {
  const bytes = new TextEncoder().encode(html);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return 'text/html; charset=utf-8';
        return null;
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

test('extractReadabilityArticleFromHtml preserves reader structure for long articles', () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Quaternion Rotations, Claude, and Lean</title></head>
      <body>
        <nav>Home About Archive Search</nav>
        <article>
          <h1>Quaternion Rotations, Claude, and Lean</h1>
          <p>I recently received an email about a post from last year.</p>
          <p>This post has ordinary prose before a proof.</p>
          <ul>
            <li>Column norms equal 1.</li>
            <li>Column orthogonality equals 0.</li>
          </ul>
          <pre><code>theorem col0_norm : Rᵀ * R = I := by
  nlinarith</code></pre>
          <p>See the <a href="/blog/2025/06/15/example">previous post</a>.</p>
        </article>
        <footer>Copyright and navigation links</footer>
      </body>
    </html>
  `;

  const result = extractReadabilityArticleFromHtml(html, 'https://www.johndcook.com/blog/2026/06/15/quaternions-claude-lean/');

  assert.equal(result?.title, 'Quaternion Rotations, Claude, and Lean');
  assert.match(result?.content || '', /I recently received an email/);
  assert.match(result?.content || '', /- Column norms equal 1\./);
  assert.match(result?.content || '', /```[\s\S]*theorem col0_norm/);
  assert.match(result?.content || '', /\[previous post\]\(https:\/\/www\.johndcook\.com\/blog\/2025\/06\/15\/example\)/);
  assert.doesNotMatch(result?.content || '', /Home About Archive Search/);
  assert.ok(plainTextLength(result?.content) > 180);
});

test('extractReadabilityArticleFromHtml removes sponsor chrome before parsing a short quotation', () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>A quote from Kimi K3</title></head>
      <body>
        <div id="sponsored-banner" class="sponsor-scheme-sky">
          <strong>Sponsored by:</strong> Atlassian - Give your agents a plan. Assign tasks from Jira.
        </div>
        <main>
          <article class="entry entryPage">
            <p class="mobile-date-eyebrow">17th July 2026</p>
            <div class="quote">
              <blockquote><p>Is there something I can actually help you with today?</p></blockquote>
              <p class="cite">Kimi K3, after refusing to leak its system prompt.</p>
            </div>
            <div class="entryFooter">Posted 17th July 2026 at 1:43 pm</div>
          </article>
          <section class="recent-articles">
            <h2>Recent articles</h2>
            <ul><li><a href="/2026/Jul/16/kimi-k3/">Older Kimi article</a></li></ul>
          </section>
        </main>
      </body>
    </html>
  `;

  const result = extractReadabilityArticleFromHtml(html, 'https://simonwillison.net/2026/Jul/17/kimi-k3/');

  assert.equal(result?.title, 'A quote from Kimi K3');
  assert.match(result?.content || '', /actually help you with today/);
  assert.match(result?.content || '', /refusing to leak its system prompt/);
  assert.doesNotMatch(result?.content || '', /Sponsored by|Atlassian|Jira/);
  assert.doesNotMatch(result?.content || '', /Recent articles|Older Kimi article/);
  assert.doesNotMatch(result?.content || '', /17th July 2026|Posted/);
});

test('htmlFragmentToMarkdown preserves Reuters lead images, captions, paragraphs, and links', () => {
  const html = `
    <figure>
      <img src="/media/tsmc-results.jpg" alt="TSMC factory">
      <figcaption>TSMC reported record quarterly profit. REUTERS/File Photo</figcaption>
    </figure>
    <p>TSMC posted a record second-quarter profit as demand for artificial intelligence processors accelerated.</p>
    <p>The company said revenue from advanced chips increased and linked the result to orders from
      <a href="/markets/companies/NVDA.O">Nvidia</a> and
      <a href="https://www.reuters.com/markets/companies/AAPL.O">Apple</a>.
    </p>
  `;

  const markdown = htmlFragmentToMarkdown(html, 'https://www.reuters.com/technology/artificial-intelligence/');

  assert.match(markdown, /!\[TSMC factory\]\(https:\/\/www\.reuters\.com\/media\/tsmc-results\.jpg\)/);
  assert.match(markdown, /TSMC reported record quarterly profit\. REUTERS\/File Photo/);
  assert.match(markdown, /TSMC posted a record second-quarter profit/);
  assert.match(markdown, /\[Nvidia\]\(https:\/\/www\.reuters\.com\/markets\/companies\/NVDA\.O\)/);
  assert.match(markdown, /\[Apple\]\(https:\/\/www\.reuters\.com\/markets\/companies\/AAPL\.O\)/);
  assert.ok(markdown.split(/\n{2,}/).filter(Boolean).length >= 4);
});

test('cleanArticleBody trims malformed RSS continuation blocks from newsflash excerpts', () => {
  const cleaned = cleanArticleBody([
    '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
    '```###',
    '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
    '36氪获悉，沪深两市成交额突破1.5万亿元。',
  ].join('\n'));

  assert.equal(cleaned, '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。');
});

test('fetchHtmlDocumentWithFallback retries with browser headers after a blocked first response', async () => {
  const seenAgents: string[] = [];
  const articleHtml = `
    <!doctype html>
    <html>
      <head><title>How engineers at Nextdoor use Codex to build without limits</title></head>
      <body>
        <article>
          <h1>How engineers at Nextdoor use Codex to build without limits</h1>
          <p>Codex helps platform engineers investigate issues and move faster.</p>
          <p>This body is long enough to act like a real article and prove the fallback path works.</p>
        </article>
      </body>
    </html>
  `;

  const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
    const agent = init?.headers?.['User-Agent'] || init?.headers?.['user-agent'] || '';
    seenAgents.push(agent);
    if (seenAgents.length === 1) {
      return createMockHtmlResponse(403, '<html><body>blocked</body></html>', 'https://openai.com/index/nextdoor');
    }
    return createMockHtmlResponse(200, articleHtml, 'https://openai.com/index/nextdoor');
  };

  const result = await fetchHtmlDocumentWithFallback('https://openai.com/index/nextdoor', 8000, {
    fetchImpl,
  });

  assert.equal(seenAgents.length, 2);
  assert.match(seenAgents[0] || '', /InfoHub\/3\.1/);
  assert.match(seenAgents[1] || '', /Mozilla\/5\.0/);
  assert.equal(result?.status, 200);
  assert.match(result?.html || '', /How engineers at Nextdoor use Codex/);
});

test('fetchHtmlDocumentWithFallback rejects an oversized declared response before reading its body', async () => {
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/oversized',
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return 'text/html; charset=utf-8';
        if (name.toLowerCase() === 'content-length') return '4096';
        return null;
      },
    },
    async arrayBuffer() {
      bodyRead = true;
      return new ArrayBuffer(4096);
    },
  });

  const result = await fetchHtmlDocumentWithFallback('https://example.com/oversized', 8000, {
    fetchImpl,
    maxResponseBytes: 1024,
  });

  assert.equal(result, null);
  assert.equal(bodyRead, false);
});

test('fetchHtmlDocumentWithFallback rejects an oversized undeclared response after bounded decoding', async () => {
  const fetchImpl = async () => createMockHtmlResponse(
    200,
    `<html><body>${'large response '.repeat(200)}</body></html>`,
    'https://example.com/oversized-without-header',
  );

  const result = await fetchHtmlDocumentWithFallback('https://example.com/oversized-without-header', 8000, {
    fetchImpl,
    maxResponseBytes: 256,
  });

  assert.equal(result, null);
});
