import test from 'node:test';
import assert from 'node:assert/strict';

const sampleSummary = [
  '# 岗位人选评估与个体成长复盘',
  '',
  '## 内容总结',
  '本次讨论围绕岗位人选争议展开，并延伸到候选人成长环境、能力验证和后续行动。',
  '',
  '## 招聘标准争议',
  '- 岗位暂时没有合适人选。',
  '- 推荐人坚持候选人具备一定教育背景优势。',
  '',
  '## 成长环境与转折点',
  '- 高中阶段经历孤独与学业逆袭。',
  '- 初入职场后面对经济压力和职业方向选择。',
  '',
  '## 后续行动',
  '- 重新确认岗位画像。',
  '- 补充候选人的能力证据。',
].join('\n');

const sampleTranscript = [
  '[00:00] 我们先讨论这个岗位为什么一直招不到合适的人。',
  '[01:15] 候选人被称作985男，但核心问题不是标签，而是能力证据。',
  '[03:20] 这里需要形成行动项，先重新确认岗位画像。',
].join('\n');

test('exposes a categorized note template library for audio minutes', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');

  assert.ok(mod.AUDIO_NOTE_CATEGORIES.includes('会议'));
  assert.ok(mod.AUDIO_NOTE_CATEGORIES.includes('个性化'));
  assert.ok(mod.AUDIO_NOTE_TEMPLATES.some((template) => template.id === 'meeting_minutes'));
  assert.ok(mod.AUDIO_NOTE_TEMPLATES.some((template) => template.id === 'visual_report'));
  assert.equal(mod.getAudioTemplate('missing')?.id, 'meeting_minutes');
});

test('builds chapters and a mind map from structured AI minutes', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '岗位讨论',
    summaryMarkdown: sampleSummary,
    transcriptMarkdown: sampleTranscript,
    templateId: 'meeting_minutes',
  });

  assert.deepEqual(artifacts.chapters.map((chapter) => chapter.title), [
    '内容总结',
    '招聘标准争议',
    '成长环境与转折点',
    '后续行动',
  ]);
  assert.equal(artifacts.mindMap.root, '岗位人选评估与个体成长复盘');
  assert.deepEqual(artifacts.mindMap.branches.map((branch) => branch.title), [
    '内容总结',
    '招聘标准争议',
    '成长环境与转折点',
    '后续行动',
  ]);
  assert.match(artifacts.mindMap.branches[1].children.join(' '), /岗位暂时没有合适人选/);
});

test('derives highlight moments and assistant suggestions without pretending they are generated answers', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '岗位讨论',
    summaryMarkdown: sampleSummary,
    transcriptMarkdown: sampleTranscript,
    templateId: 'meeting_minutes',
  });

  assert.ok(artifacts.highlights.length >= 2);
  assert.match(artifacts.highlights[0].text, /岗位为什么一直招不到/);
  assert.deepEqual(artifacts.qaSuggestions.map((item) => item.kind), [
    'weekly_digest',
    'todo',
    'progress_blocker',
    'quote_check',
    'theme_conflict',
  ]);
  assert.equal(artifacts.qaSuggestions[0].generated, false);
});

test('falls back to transcript sections when AI summary is empty', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '一段录音',
    summaryMarkdown: '',
    transcriptMarkdown: sampleTranscript,
    templateId: 'generic',
  });

  assert.ok(artifacts.chapters.length >= 1);
  assert.equal(artifacts.chapters[0].source, 'transcript');
  assert.equal(artifacts.mindMap.root, '一段录音');
  assert.match(artifacts.readingHint, /当前结果基于转写稿自动整理/);
});

test('prefers persisted timed audio artifacts over transient markdown inference', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '岗位讨论',
    summaryMarkdown: sampleSummary,
    transcriptMarkdown: sampleTranscript,
    templateId: 'meeting_minutes',
    persistedArtifacts: {
      schema: 'audio_artifacts_v1',
      version: 1,
      chapters: [{
        id: 'chapter-real-1',
        title: '真实时间章节',
        summary: '这是后端根据 AI 时间锚点和 ASR 时间轴生成的章节。',
        bullets: ['证据一'],
        start: 289.4,
        end: 599.674,
        speakers: ['0', '1'],
        source: 'summary_timestamp+asr',
      }],
      highlights: [{
        id: 'highlight-real-1',
        title: '关键原话',
        text: '这句话可以准确定位回听。',
        reason: '来自 ASR 时间轴。',
        start: 305.2,
        end: 312.6,
        speaker: '1',
        source: 'asr',
      }],
      mind_map: {
        root: '真实思维导图',
        branches: [{ title: '真实分支', children: ['证据一'], chapter_id: 'chapter-real-1' }],
      },
      qa: {
        suggestions: [{ key: 'actions', label: '整理行动项', prompt: '整理这段录音的行动项。' }],
        answers: [{
          id: 'qa-real-1',
          question: '下一步是什么？',
          prompt_key: 'actions',
          answer: '先补齐验收证据。',
          citations: [{
            id: 'citation-1',
            start: 305.2,
            end: 312.6,
            time_label: '5:05-5:12',
            text: '先补齐验收证据。',
            speaker: '1',
          }],
          status: 'ready',
          model: 'model-a',
          created_at: '2026-07-15T00:00:00Z',
        }],
      },
    },
  });

  assert.equal(artifacts.chapters.length, 1);
  assert.equal(artifacts.chapters[0].id, 'chapter-real-1');
  assert.equal(artifacts.chapters[0].timeLabel, '4:49');
  assert.equal(artifacts.chapters[0].startSeconds, 289.4);
  assert.equal(artifacts.chapters[0].source, 'summary_timestamp+asr');
  assert.equal(artifacts.highlights[0].startSeconds, 305.2);
  assert.equal(artifacts.mindMap.branches[0].chapterId, 'chapter-real-1');
  assert.equal(artifacts.qaSuggestions[0].kind, 'todo');
  assert.equal(artifacts.qaSuggestions[0].promptKey, 'actions');
  assert.equal(artifacts.qaAnswers[0].citations[0].startSeconds, 305.2);
  assert.equal(artifacts.qaAnswers[0].answer, '先补齐验收证据。');
  assert.match(artifacts.readingHint, /已保存的章节/);
});

test('ignores malformed persisted artifacts and keeps legacy fallback readable', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '岗位讨论',
    summaryMarkdown: sampleSummary,
    transcriptMarkdown: sampleTranscript,
    persistedArtifacts: {
      schema: 'audio_artifacts_v1',
      version: 1,
      chapters: [],
    },
  });

  assert.equal(artifacts.chapters[0].title, '内容总结');
  assert.equal(artifacts.chapters[0].source, 'summary');
});

test('keeps tables separators and full transcript sections out of quick insights', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const pollutedSummary = [
    '# 项目复盘',
    '## 关键结论',
    '建议先完成真实环境验收。',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| 回归 | 进行中 |',
    '---',
    '## 下一步',
    '- 负责人需要在周五前补齐证据。',
    '## 完整逐字稿',
    '[08:00] 下一步下一步下一步，这是一整段不应进入快速洞察的逐字稿内容。',
  ].join('\n');

  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '项目复盘',
    summaryMarkdown: pollutedSummary,
    transcriptMarkdown: '[02:00] 建议先完成真实环境验收。\n[07:00] 负责人需要在周五前补齐证据。',
  });
  const serialized = JSON.stringify(artifacts);

  assert.deepEqual(artifacts.chapters.map((chapter) => chapter.title), ['关键结论', '下一步']);
  assert.doesNotMatch(serialized, /完整逐字稿|\| 项目 \| 状态 \||下一步下一步下一步/);
  assert.equal(artifacts.highlights.length, 2);
});

test('filters polluted highlights from older persisted assets', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');
  const artifacts = mod.buildAudioWorkshopArtifacts({
    title: '旧任务',
    summaryMarkdown: '',
    transcriptMarkdown: '',
    persistedArtifacts: {
      schema: 'audio_artifacts_v1',
      version: 1,
      chapters: [{ id: 'chapter-1', title: '关键结论', summary: '这是可读的章节摘要。', bullets: [] }],
      highlights: [
        { id: 'bad-table', text: '| 项目 | 状态 |', title: '表格', reason: '旧资产' },
        { id: 'bad-separator', text: '---', title: '分隔符', reason: '旧资产' },
        { id: 'good', text: '团队决定先完成真实环境验收。', title: '关键决策', reason: '旧资产' },
      ],
      mind_map: { root: '旧任务', branches: [] },
      qa: { suggestions: [], answers: [] },
    },
  });

  assert.equal(artifacts.highlights.length, 1);
  assert.equal(artifacts.highlights[0].id, 'good');
});

test('formats audio timestamps for chapter and highlight playback', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');

  assert.equal(mod.formatAudioTime(0), '0:00');
  assert.equal(mod.formatAudioTime(289.4), '4:49');
  assert.equal(mod.formatAudioTime(3723), '1:02:03');
  assert.equal(mod.formatAudioTime(null), null);
});

test('resolves audio playback source without treating storage keys as playable URLs', async () => {
  const mod = await import('../src/lib/audio-workshop.ts');

  assert.deepEqual(mod.resolveAudioPlaybackSource({
    taskId: 'task-1',
    audioUrl: 'https://cdn.example.com/a.mp3',
    signedPlaybackUrl: '',
    loading: false,
    error: '',
  }), {
    src: 'https://cdn.example.com/a.mp3',
    status: 'ready',
    message: '',
  });

  assert.deepEqual(mod.resolveAudioPlaybackSource({
    taskId: 'task-1',
    audioUrl: 'audio-insight/2026/03/10/file.mp3',
    signedPlaybackUrl: '',
    loading: false,
    error: '',
  }), {
    src: '',
    status: 'needs_signed_url',
    message: '音频文件已在存储中，需要先获取临时播放地址。',
  });

  assert.deepEqual(mod.resolveAudioPlaybackSource({
    taskId: 'task-1',
    audioUrl: 'audio-insight/2026/03/10/file.mp3',
    signedPlaybackUrl: 'https://signed.example.com/file.mp3',
    loading: false,
    error: '',
  }).src, 'https://signed.example.com/file.mp3');
});
