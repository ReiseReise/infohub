import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAnthropicNewsItems,
  parseBestBlogsBriefItems,
  parseBestBlogsBriefPayload,
  resolveBestBlogsOriginalUrlFromHtml,
} from './webpage-index.js';

test('parses BestBlogs public brief API payload into individual article items', () => {
  const payload = {
    success: true,
    data: {
      briefDate: '2026-06-10',
      contentItems: [
        {
          resourceId: 'RAW_11f30fed',
          contentType: 'ARTICLE',
          language: 'en_US',
          title: 'Anthropic 发布新一代 Claude：Fable 5 与网络安全版 Mythos 5',
          url: 'https://www.anthropic.com/news/claude-fable-5',
          matchReason: 'Anthropic 将 Claude Fable 5 推向大众，并解释安全降级、价格和企业案例。',
          sourceName: 'Anthropic News',
          weightedScore: 95,
          featured: true,
          deepRead: true,
        },
        {
          resourceId: 'RAW_d12e437d',
          contentType: 'ARTICLE',
          title: 'Salesforce 从 20,000 个企业智能体部署中学到的经验',
          matchReason: 'Agentforce 复盘说明生产级 Agent 的上线后运营、知识治理和反馈循环。',
          sourceName: 'ByteByteGo Newsletter',
          totalScore: 88,
        },
      ],
    },
  };

  const items = parseBestBlogsBriefPayload(payload, {
    indexUrl: 'https://www.bestblogs.dev/en/explore/brief',
    capturedAt: new Date('2026-06-10T08:00:00Z'),
    locale: 'zh',
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Anthropic 发布新一代 Claude：Fable 5 与网络安全版 Mythos 5');
  assert.equal(items[0].url, 'https://www.bestblogs.dev/article/11f30fed?utm_source=brief&utm_medium=infohub&utm_campaign=2026-06-10&entry=infohub_brief_item');
  assert.equal(items[0].originalUrl, 'https://www.anthropic.com/news/claude-fable-5');
  assert.equal(items[0].curationUrl, 'https://www.bestblogs.dev/en/explore/brief');
  assert.equal(items[0].curationSource, 'BestBlogs Daily Brief');
  assert.equal(items[0].guid, 'bestblogs:RAW_11f30fed');
  assert.equal(items[0].author, 'Anthropic News');
  assert.equal(items[0].fetchEngine, 'bestblogs-public-brief');
  assert.equal(items[0].renderMode, 'index-api');
  assert.match(items[0].content || '', /榜单摘要/);
  assert.match(items[0].content || '', /来源站点：Anthropic News/);
  assert.match(items[0].content || '', /原文待补抓/);
  assert.deepEqual(items[0].rawData?.score, 95);
});

test('resolves original links from BestBlogs detail html without using BestBlogs internal links', () => {
  const html = `
    <html>
      <head>
        <link rel="canonical" href="https://www.bestblogs.dev/article/bff54423" />
      </head>
      <body>
        <script>
          self.__next_f.push([1, '"originalUrl":"https://www.anthropic.com/policy/ai-exponential-growth"']);
        </script>
        <a href="https://www.bestblogs.dev/explore/brief">Brief</a>
      </body>
    </html>
  `;

  const resolved = resolveBestBlogsOriginalUrlFromHtml(html, 'https://www.bestblogs.dev/article/bff54423');
  assert.equal(resolved, 'https://www.anthropic.com/policy/ai-exponential-growth');
});

test('falls back to first external article link from BestBlogs detail html', () => {
  const html = `
    <main>
      <a href="/article/internal">Internal</a>
      <a href="https://example.com/deep-post">Read original</a>
    </main>
  `;

  const resolved = resolveBestBlogsOriginalUrlFromHtml(html, 'https://www.bestblogs.dev/article/bff54423');
  assert.equal(resolved, 'https://example.com/deep-post');
});

test('resolves original links from escaped BestBlogs app-router payload fields', () => {
  const html = `
    <script>
      self.__next_f.push([1, "12:[\\"$\\",\\"article\\",null,{\\"resource\\":{\\"articleUrl\\":\\"https:\\\\/\\\\/simonwillison.net\\\\/2026\\\\/Jun\\\\/16\\\\/claude-code-notes\\",\\"siteUrl\\":\\"https:\\\\/\\\\/simonwillison.net\\"}}]"]);
    </script>
  `;

  const resolved = resolveBestBlogsOriginalUrlFromHtml(html, 'https://www.bestblogs.dev/article/abc123');
  assert.equal(resolved, 'https://simonwillison.net/2026/Jun/16/claude-code-notes');
});

test('unwraps BestBlogs outbound tracking links before accepting an original article url', () => {
  const html = `
    <main>
      <a href="https://www.bestblogs.dev/redirect?url=https%3A%2F%2Fwww.theverge.com%2Fai-artificial-intelligence%2F946725%2Fanthropic-releases-claude-fable-5">Read original</a>
    </main>
  `;

  const resolved = resolveBestBlogsOriginalUrlFromHtml(html, 'https://www.bestblogs.dev/article/abc123');
  assert.equal(resolved, 'https://www.theverge.com/ai-artificial-intelligence/946725/anthropic-releases-claude-fable-5');
});

test('parses BestBlogs brief cards into individual article items', () => {
  const html = `
    <main>
      <article>
        <a href="https://example.com/terraform-1-15">
          <h2>Terraform 1.15 缩小与 OpenTofu 在动态源和弃用功能上的差距</h2>
          <p>HashiCorp 发布 Terraform 1.15，重点补齐动态模块源和弃用属性。</p>
          <img src="https://cdn.example.com/terraform.png" />
        </a>
        <span>BestBlogs.dev · 36 分钟前</span>
      </article>
      <article>
        <a href="https://example.org/logicappless">
          <h2>微软在 Build 2026 上推出 Logic Apps Automation</h2>
          <p>面向企业流程自动化的新能力。</p>
        </a>
      </article>
    </main>
  `;

  const items = parseBestBlogsBriefItems(html, {
    indexUrl: 'https://www.bestblogs.dev/en/explore/brief',
    capturedAt: new Date('2026-06-10T08:00:00Z'),
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Terraform 1.15 缩小与 OpenTofu 在动态源和弃用功能上的差距');
  assert.equal(items[0].url, 'https://example.com/terraform-1-15');
  assert.match(items[0].guid || '', /^bestblogs:/);
  assert.match(items[0].content || '', /BestBlogs Daily Brief/);
  assert.match(items[0].content || '', /榜单摘要/);
  assert.equal(items[0].mediaUrl, 'https://cdn.example.com/terraform.png');
  assert.equal(items[0].mediaType, 'image');
  assert.equal(items[0].fetchEngine, 'webpage-index');
});

test('ignores navigation and internal BestBlogs links', () => {
  const html = `
    <nav><a href="/en/explore">Explore</a></nav>
    <a href="https://www.bestblogs.dev/en/explore/brief"><span>Brief</span></a>
    <a href="https://example.com/deep-post"><h3>Deep post title</h3><p>Readable summary for a real post.</p></a>
  `;

  const items = parseBestBlogsBriefItems(html, {
    indexUrl: 'https://www.bestblogs.dev/en/explore/brief',
    capturedAt: new Date('2026-06-10T08:00:00Z'),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/deep-post');
});

test('parses Anthropic newsroom cards into individual news items instead of a homepage snapshot', () => {
  const html = `
    <main>
      <a href="/news/claude-fable-5">
        <span>Announcements</span>
        <time datetime="2026-06-09">Jun 9, 2026</time>
        <h2>Claude Fable 5 and Claude Mythos 5</h2>
        <p>Our next generation of intelligence for the hardest knowledge work and coding problems.</p>
      </a>
      <a href="/news/policy-on-the-ai-exponential">
        <span>Policy</span>
        <time datetime="2026-06-10">Jun 10, 2026</time>
        <h2>Policy on the AI Exponential</h2>
        <p>Policy proposals to prepare institutions for AI progress.</p>
      </a>
      <a href="mailto:press@anthropic.com">Press inquires</a>
      <a href="/contact">How to get support</a>
    </main>
  `;

  const items = parseAnthropicNewsItems(html, {
    indexUrl: 'https://www.anthropic.com/news',
    capturedAt: new Date('2026-06-11T08:00:00Z'),
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Claude Fable 5 and Claude Mythos 5');
  assert.equal(items[0].url, 'https://www.anthropic.com/news/claude-fable-5');
  assert.equal(items[0].originalUrl, 'https://www.anthropic.com/news/claude-fable-5');
  assert.equal(items[0].curationSource, 'Anthropic Newsroom');
  assert.equal(items[0].author, 'Anthropic');
  assert.equal(items[0].publishedAt?.toISOString(), '2026-06-09T00:00:00.000Z');
  assert.match(items[0].content || '', /## Anthropic Newsroom/);
  assert.match(items[0].content || '', /分类：Announcements/);
  assert.doesNotMatch(items[0].content || '', /press@anthropic\.com|How to get support/i);
});

test('parses Anthropic newsroom link-list markup from the live page structure', () => {
  const html = `
    <main>
      <article>Hero content without news cards</article>
      <a href="/news/claude-fable-5">Jun 9, 2026 Announcements Claude Fable 5 and Claude Mythos 5</a>
      <a href="/news/policy-on-the-ai-exponential">Jun 10, 2026 Policy Policy on the AI Exponential</a>
      <a href="/news/chris-olah-pope-leo-encyclical">May 25, 2026 Announcements Anthropic co-founder Chris Olah&#x27;s remarks</a>
      <a href="https://support.claude.com">How to get support</a>
    </main>
  `;

  const items = parseAnthropicNewsItems(html, {
    indexUrl: 'https://www.anthropic.com/news',
    capturedAt: new Date('2026-06-11T00:00:00Z'),
  });

  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Claude Fable 5 and Claude Mythos 5');
  assert.equal(items[1].title, 'Policy on the AI Exponential');
  assert.equal(items[2].title, "Anthropic co-founder Chris Olah's remarks");
  assert.equal(items[0].originalUrl, 'https://www.anthropic.com/news/claude-fable-5');
});
