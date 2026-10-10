import test from 'node:test';
import assert from 'node:assert/strict';

test('converts HTML pre/code blocks into fenced markdown code blocks', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.htmlToReadableMarkdown([
    '<p>Intro paragraph.</p>',
    '<pre><code>theorem col0_norm : True := by trivial</code></pre>',
    '<p>Outro paragraph.</p>',
  ].join('\n'));

  assert.match(markdown, /Intro paragraph\./);
  assert.match(markdown, /```\ntheorem col0_norm : True := by trivial\n```/);
  assert.match(markdown, /Outro paragraph\./);
});

test('treats indented pre-wrap code paragraphs from RSS feeds as code blocks', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.htmlToReadableMarkdown([
    '<p>Lean proof:</p>',
    '<p class="whitespace-pre-wrap break-words" style="padding-left: 40px;">theorem col1_norm (h : q0 ^ 2 + q1 ^ 2 = 1) : True := by<br />  nlinarith</p>',
  ].join('\n'));

  assert.match(markdown, /Lean proof:/);
  assert.match(markdown, /```\ntheorem col1_norm/);
  assert.match(markdown, /nlinarith\n```/);
  assert.doesNotMatch(markdown, /theorem col1_norm[\s\S]*<\/p>/);
});

test('treats plain html theorem paragraphs as code blocks even without pre-wrap styles', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.htmlToReadableMarkdown([
    '<p>Author received a note about a year-old post.</p>',
    '<p>variable (q0 q1 q2 q3 : R)</p>',
    '<p>/-! ## Theorem 1 : Rᵀ R = I -/</p>',
    '<p>theorem col0_norm (h : q0 ^ 2 + q1 ^ 2 + q2 ^ 2 + q3 ^ 2 = 1) : True := by<br />  nlinarith [sq_nonneg q0, sq_nonneg q1, sq_nonneg q2, sq_nonneg q3]</p>',
    '<p>The post then returns to prose and explains why this matters.</p>',
  ].join('\n'));

  assert.match(markdown, /Author received a note about a year-old post\./);
  assert.match(markdown, /```[\s\S]*variable \(q0 q1 q2 q3 : R\)/);
  assert.match(markdown, /\/-! ## Theorem 1 : Rᵀ R = I -\//);
  assert.match(markdown, /theorem col0_norm/);
  assert.match(markdown, /nlinarith \[sq_nonneg q0/);
  assert.match(markdown, /The post then returns to prose and explains why this matters\./);
});

test('detects pre and code fragments as HTML content', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  assert.equal(mod.looksLikeHtmlFragment('<pre><code>x := y</code></pre>'), true);
  assert.equal(mod.looksLikeHtmlFragment('<code>x := y</code>'), true);
});

test('converts plain-text theorem and proof blocks into fenced markdown while preserving prose', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.plainTextToReadableMarkdown([
    'Author received a note about a year-old post.',
    '',
    'variable (q0 q1 q2 q3 : ℝ)',
    '',
    '/-! ## Theorem 1 : Rᵀ R = I -/',
    '',
    'theorem col0_norm (h : q0 ^ 2 + q1 ^ 2 + q2 ^ 2 + q3 ^ 2 = 1) : (2 * (q0 ^ 2 + q1 ^ 2) - 1) ^ 2 = 1 := by',
    '  nlinarith [sq_nonneg q0, sq_nonneg q1, sq_nonneg q2, sq_nonneg q3]',
    '',
    'The post then returns to prose and explains why this matters.',
  ].join('\n'));

  assert.match(markdown, /Author received a note about a year-old post\./);
  assert.match(markdown, /```[\s\S]*variable \(q0 q1 q2 q3 : ℝ\)/);
  assert.match(markdown, /theorem col0_norm/);
  assert.match(markdown, /nlinarith \[sq_nonneg q0/);
  assert.match(markdown, /```[\s\S]*The post then returns to prose and explains why this matters\./);
});

test('decodes common HTML entities in readable markdown output', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.htmlToReadableMarkdown('<p>Claude &amp; Lean &hellip; proof &mdash; still readable.</p>');

  assert.match(markdown, /Claude & Lean … proof — still readable\./);
  assert.doesNotMatch(markdown, /&hellip;|&mdash;/);
});

test('preserves article figures and lead images from RSS HTML content', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.htmlToReadableMarkdown([
    '<figure class="article-lead-image">',
    '<img src="https://cdn.example.com/reuters-ai.jpg" alt="AI Impact Summit in New Delhi" loading="eager">',
    '<figcaption>Visitors check a Jio intelligence bot. REUTERS/File Photo</figcaption>',
    '</figure>',
    '<p>Hiring for AI roles outpaced overall recruitment.</p>',
  ].join('\n'));

  assert.match(markdown, /!\[AI Impact Summit in New Delhi\]\(https:\/\/cdn\.example\.com\/reuters-ai\.jpg\)/);
  assert.match(markdown, /Visitors check a Jio intelligence bot\. REUTERS\/File Photo/);
  assert.match(markdown, /Hiring for AI roles outpaced overall recruitment\./);
});

test('keeps standalone markdown images out of code fences', async () => {
  const { plainTextToReadableMarkdown } = await import('../src/lib/readable-content.ts');
  const longImageUrl = 'https://oss.zhidx.com/uploads/2026/07/6a54ecf181738_6a54ecf17e44d_6a54ecf17e415_%E5%9B%BE%E7%89%87_20260713212338_1895_16.jpg';
  const result = plainTextToReadableMarkdown(`![](${longImageUrl})\n\n正文第一段。`);

  assert.match(result, new RegExp(`^!\\[\\]\\(${longImageUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\)`));
  assert.doesNotMatch(result, /```[\s\S]*!\[\]/);
});

test('rejects short partial translations for long source articles', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const source = [
    'Visitors check a Jio intelligence bot on display at Bharat Mandapam.',
    'Hiring for AI roles within India IT sector outpaced overall recruitment.',
    'The sector AI hiring rose year on year while overall IT jobs declined.',
  ].join(' ').repeat(14);
  const shortTranslation = [
    '标题：报告显示，印度人工智能岗位招聘增速超过整体IT行业招聘。',
    '周五发布的一项调查显示，印度IT行业上月人工智能岗位招聘速度超过了整体招聘速度。',
  ].join('\n\n');

  assert.equal(mod.isUsableDisplayTranslation(shortTranslation, source), false);
});

test('rejects embedded structured translation JSON even when surrounding text is Chinese', async () => {
  const mod = await import('../src/lib/readable-content.ts');
  const translation = [
    '这是一段看起来正常的中文译文。'.repeat(12),
    '{"blocks":[{"id":"b0002","markdown":"内部结构"}]}',
    '后续仍然是中文正文。'.repeat(12),
  ].join('\n\n');

  assert.equal(mod.isUsableDisplayTranslation(translation, 'Source article. '.repeat(40)), false);
});

test('rejects visibly truncated AI reading summaries', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  assert.equal(mod.isUsableDisplaySummary('台积电第二季度利润同比增长77%，创历史新高。财报显示'), false);
  assert.equal(mod.isUsableDisplaySummary('台积电第二季度净利润同比增长77%，创历史新高，并明显超过分析师预期。人工智能处理器需求持续上升，进一步强化了公司在先进芯片供应链中的关键地位。'), true);
});

test('rejects Reuters-sized partial translations before rendering', async () => {
  const mod = await import('../src/lib/readable-content.ts');
  const source = 'TSMC posted record profit as demand for AI processors accelerated globally. '.repeat(18);
  const translation = '台积电公布创纪录利润，人工智能处理器需求继续增长。'.repeat(12).slice(0, 317);

  assert.equal(mod.isUsableDisplayTranslation(translation, source), false);
});

test('rejects Reuters-sized 368 character translations for 2500 character source articles', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const source = 'Hiring for AI roles within India IT sector outpaced overall recruitment. '.repeat(36);
  const translation = '印度IT行业人工智能岗位招聘增速超过整体招聘速度，企业正在面对技术演进推动自身转型。'.repeat(12).slice(0, 368);

  assert.ok(source.length >= 2500 && source.length < 2700);
  assert.equal(translation.length, 368);
  assert.equal(mod.isUsableDisplayTranslation(translation, source), false);
});

test('rejects translations that lose source links, images and paragraph structure despite enough text', async () => {
  const mod = await import('../src/lib/readable-content.ts');
  const source = [
    '<p>Opening context for the article and its central claim.</p>',
    '<p>Second paragraph with supporting evidence.</p>',
    '<p>Third paragraph links to <a href="https://example.com/evidence">the primary evidence</a>.</p>',
    '<figure><img src="https://example.com/figure.png" alt="Evidence chart"></figure>',
    '<p>Fourth paragraph explains the method.</p>',
    '<p>Fifth paragraph adds limitations.</p>',
    '<p>Sixth paragraph gives the conclusion.</p>',
  ].join('');
  const translation = '这是一篇长度看起来足够的中文译文。'.repeat(60);

  assert.equal(mod.isUsableDisplayTranslation(translation, source), false);
});

test('trims malformed RSS continuation blocks in plain text reader output', async () => {
  const mod = await import('../src/lib/readable-content.ts');

  const markdown = mod.plainTextToReadableMarkdown([
    '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。',
    '```###',
    '[沪深两市成交额突破1.5万亿元](https://36kr.com/newsflashes/next)',
    '36氪获悉，沪深两市成交额突破1.5万亿元。',
  ].join('\n'));

  assert.equal(markdown, '36氪获悉，算力芯片概念震荡走强，寒武纪涨超10%创历史新高。');
});

test('keeps prose paragraphs with markdown links out of code fences', async () => {
  const mod = await import('../src/lib/readable-content.ts');
  const paragraph = 'The company announced a new product with [deployment guidance](https://example.com/guidance), [pricing details](https://example.com/pricing), and several implementation notes for enterprise teams that need a reliable migration path.';

  const markdown = mod.plainTextToReadableMarkdown(paragraph);

  assert.equal(markdown, paragraph);
  assert.equal(markdown.includes('```'), false);
});
