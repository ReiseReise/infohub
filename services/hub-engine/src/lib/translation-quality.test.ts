import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTranslationArtifact } from './translation-quality.js';

test('rejects structured JSON leaked into an otherwise Chinese translation', () => {
  const source = 'A full source paragraph about the model release. '.repeat(30);
  const translation = [
    '这是一段看起来正常的中文译文，前半部分包含了模型发布、能力变化和公开说明。'.repeat(6),
    '{"blocks":[{"id":"b0002","markdown":"第二段译文"}]}',
    '后半部分继续显示中文，因此不能只依赖中文比例判断。'.repeat(6),
  ].join('\n\n');

  const result = evaluateTranslationArtifact(translation, source);
  assert.equal(result.usable, false);
  assert.equal(result.reasonCode, 'structured_output_leak');
  assert.equal(result.formatVersion, 'translation-v2');
});

test('rejects translations that lose source paragraphs and links', () => {
  const source = [
    'First source paragraph with enough detail to matter.',
    'Second source paragraph with enough detail to matter.',
    'Third source paragraph with enough detail to matter.',
    'Fourth source paragraph with a [reference](https://example.com/reference).',
  ].join('\n\n');
  const result = evaluateTranslationArtifact(
    '这是一段中文概括，虽然长度不算为空，但没有逐段覆盖原文，也没有保留链接。'.repeat(6),
    source,
  );

  assert.equal(result.usable, false);
  assert.equal(result.reasonCode, 'missing_paragraphs');
});

test('accepts a complete Chinese translation with preserved structures', () => {
  const source = [
    'First source paragraph with enough detail to matter.',
    'Second source paragraph with enough detail to matter.',
    'Third source paragraph with enough detail to matter.',
    'Fourth source paragraph with a [reference](https://example.com/reference).',
  ].join('\n\n');
  const translation = [
    '第一段完整说明了原文中的事实，并保持自然段结构。',
    '第二段继续忠实呈现原文内容，没有将全文压缩成摘要。',
    '第三段保留了原有的论证顺序和必要的专有名词。',
    '第四段保留[参考链接](https://example.com/reference)，并完成中文化。',
  ].join('\n\n');

  const result = evaluateTranslationArtifact(translation, source);
  assert.equal(result.usable, true);
  assert.equal(result.reasonCode, null);
});
