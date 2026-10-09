import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikeMarkdown, normalizeMarkdownImages } from '../src/components/MarkdownContent.tsx';

test('reader markdown wraps long code lines instead of widening the reading pane', async () => {
  const componentPath = process.cwd().endsWith('/apps/web')
    ? join(process.cwd(), 'src/components/MarkdownContent.tsx')
    : join(process.cwd(), 'apps/web/src/components/MarkdownContent.tsx');
  const source = readFileSync(componentPath, 'utf8');

  assert.match(source, /\[&_pre\]:overflow-x-hidden/);
  assert.match(source, /\[&_pre\]:whitespace-pre-wrap/);
  assert.match(source, /\[&_pre_code\]:whitespace-pre-wrap/);
  assert.match(source, /\[&_pre_code\]:break-words/);
});

test('reader markdown keeps images responsive and tables locally scrollable', () => {
  const componentPath = process.cwd().endsWith('/apps/web')
    ? join(process.cwd(), 'src/components/MarkdownContent.tsx')
    : join(process.cwd(), 'apps/web/src/components/MarkdownContent.tsx');
  const source = readFileSync(componentPath, 'utf8');

  assert.match(source, /\[&_img\]:h-auto/);
  assert.match(source, /\[&_img\]:w-full/);
  assert.match(source, /\[&_img\]:object-contain/);
  assert.match(source, /\[&_table\]:block/);
  assert.match(source, /\[&_table\]:w-full/);
  assert.match(source, /\[&_table\]:overflow-x-auto/);
});

test('normalizes empty-alt remote images without changing regular markdown images', () => {
  assert.equal(
    normalizeMarkdownImages('![](https://cdn.example.com/cover.jpg)'),
    '![图片](https://cdn.example.com/cover.jpg)',
  );
  assert.equal(
    normalizeMarkdownImages('![]\n(https://cdn.example.com/cover.jpg)'),
    '![图片](https://cdn.example.com/cover.jpg)',
  );
  assert.equal(
    normalizeMarkdownImages('![封面](https://cdn.example.com/cover.jpg)'),
    '![封面](https://cdn.example.com/cover.jpg)',
  );
  assert.equal(
    normalizeMarkdownImages('![](/local/cover.jpg)'),
    '![](/local/cover.jpg)',
  );

});

test('renders translated prose with inline links as markdown', () => {
  const translatedArticle = [
    '创始人[宣布](https://example.com/announcement)推出一项新服务。',
    '',
    '团队随后发布了[完整说明](/docs/launch)，并保留原文段落结构。',
  ].join('\n');

  assert.equal(looksLikeMarkdown(translatedArticle), true);
  assert.equal(looksLikeMarkdown('这是没有 Markdown 标记的普通自然段。'), false);
});
