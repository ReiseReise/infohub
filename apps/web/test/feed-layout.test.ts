import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('places feed detail before the list on narrow screens when an item is selected', async () => {
  const mod = await import('../src/lib/feed-layout.ts').catch(() => ({}));
  const resolveFeedDetailOrderClassName = (mod as {
    resolveFeedDetailOrderClassName?: (hasSelectedItem: boolean) => string;
  }).resolveFeedDetailOrderClassName;

  assert.equal(typeof resolveFeedDetailOrderClassName, 'function');
  assert.match(resolveFeedDetailOrderClassName(true), /order-first/);
  assert.match(resolveFeedDetailOrderClassName(true), /xl:order-none/);
});

test('keeps feed detail after the list on narrow screens when no item is selected', async () => {
  const { resolveFeedDetailOrderClassName } = await import('../src/lib/feed-layout.ts');

  assert.equal(resolveFeedDetailOrderClassName(false), '');
});

test('auto-scrolls selected feed detail into view on narrow screens only', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 390), true);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 1279), true);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(true, 1280), false);
  assert.equal(mod.shouldAutoScrollFeedDetailIntoView(false, 390), false);
});

test('uses a stacked feed detail header before desktop width', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.match(mod.feedDetailHeaderClassName, /flex-col/);
  assert.match(mod.feedDetailHeaderClassName, /sm:flex-row/);
});

test('defaults the feed queue to recommended while preserving latest as an explicit view', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.normalizeFeedSortMode(null), 'priority');
  assert.equal(mod.normalizeFeedSortMode('latest'), 'latest');
  assert.equal(mod.feedViewForSortMode('priority'), 'recommended');
  assert.equal(mod.feedViewForSortMode('score'), 'recommended');
  assert.equal(mod.feedViewForSortMode('latest'), 'latest');
  assert.equal(mod.feedQuerySortValue('priority'), '');
  assert.equal(mod.feedQuerySortValue('latest'), 'latest');
});

test('keeps draggable feed list width within a stable reading range', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.clampFeedListPaneWidth(260), 340);
  assert.equal(mod.clampFeedListPaneWidth(430), 430);
  assert.equal(mod.clampFeedListPaneWidth(720), 460);
});

test('keeps the feed workbench height budget reader-first on desktop', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.match(mod.feedWorkbenchGridClassName, /xl:flex-1/);
  assert.doesNotMatch(mod.feedWorkbenchGridClassName, /100dvh/);
});

test('keeps feed top controls in a compact single desktop toolbar', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(typeof mod.feedTopbarClassName, 'string');
  assert.match(mod.feedTopbarClassName, /mb-1/);
  assert.match(mod.feedTopbarClassName, /rounded-xl/);
  assert.doesNotMatch(mod.feedTopbarClassName, /rounded-2xl/);

  assert.equal(typeof mod.feedTopbarToolbarClassName, 'string');
  assert.match(mod.feedTopbarToolbarClassName, /xl:grid/);
  assert.match(mod.feedTopbarToolbarClassName, /minmax\(240px,1fr\)/);
  assert.match(mod.feedTopbarToolbarClassName, /2xl:grid-cols/);
  assert.doesNotMatch(mod.feedTopbarToolbarClassName, /flex-col/);
});

test('keeps source rail badges low-noise for long reading sessions', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const badges = mod.resolveFeedSourceRailBadges({
    sourceTier: 'A',
    readingTierLabel: '高价值',
    readingTierReason: '人工标记',
    qualityLabel: '优质',
  });

  assert.deepEqual(badges.map((badge: { label: string }) => badge.label), ['高价值']);
});

test('keeps feed list card badges compact and moves secondary signals out of the main row', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const signals = mod.resolveFeedListCardSignals({
    aiScore: 87.67,
    sourceTier: 'S',
    sourceTierLabel: 'S级信号',
    sourceTierClassName: 'bg-rose-100 text-rose-700',
    aiStatusLabel: '已翻译',
    aiStatusClassName: 'bg-emerald-100 text-emerald-700',
    contentReadinessLabel: '全文可读',
    readingTierLabel: '高价值',
    growthAxes: ['认知升级', '商业判断'],
    assetCount: 3,
  });

  assert.deepEqual(signals.primary.map((signal: { kind: string }) => signal.kind), ['score', 'tier', 'readiness']);
  assert.ok(signals.primary.length <= 3);
  assert.deepEqual(signals.secondary.map((signal: { kind: string }) => signal.kind), ['ai', 'readingTier', 'assets', 'growth']);
  assert.match(signals.tooltip, /已翻译/);
  assert.match(signals.tooltip, /资产 3/);
  assert.match(signals.tooltip, /认知升级/);
});

test('labels local corroboration separately from external radar discovery', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedEventEvidenceLabel({
    internalSourceCount: 3,
    externalSourceCount: 5,
    firstPartyCount: 1,
  }), {
    label: '3 个来源印证',
    title: '本地已抓取 3 个来源，其中 1 个一手来源；外部雷达另发现 5 个来源。',
  });
  assert.deepEqual(mod.resolveFeedEventEvidenceLabel({
    internalSourceCount: 1,
    externalSourceCount: 4,
    firstPartyCount: 0,
  }), {
    label: '外部雷达 4',
    title: '外部雷达发现 4 个来源，尚未等同于本地核验。',
  });
  assert.equal(mod.resolveFeedEventEvidenceLabel({
    internalSourceCount: 1,
    externalSourceCount: 0,
    firstPartyCount: 0,
  }), null);
});

test('explains when a feed detail URL source filter does not match the real item source', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const mismatch = mod.resolveFeedSourceMismatchNotice({
    querySourceId: '1354',
    itemSourceId: 786,
    itemSourceName: 'Daring Fireball',
    filterSourceName: 'Anthropic Newsroom',
  });

  assert.equal(mismatch?.tone, 'warning');
  assert.match(mismatch?.message || '', /真实来源是 Daring Fireball/);
  assert.match(mismatch?.message || '', /Anthropic Newsroom/);
  assert.equal(mod.resolveFeedSourceMismatchNotice({
    querySourceId: '786',
    itemSourceId: 786,
    itemSourceName: 'Daring Fireball',
  }), null);
});

test('clears stale source filters for deep-linked feed detail pages', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedDetailSourceContext({
    selectedIdFromRoute: 'item-1',
    querySourceId: '1354',
    itemSourceId: 786,
  }), { shouldClearSourceFilter: true });

  assert.deepEqual(mod.resolveFeedDetailSourceContext({
    selectedIdFromRoute: 'item-1',
    querySourceId: '786',
    itemSourceId: 786,
  }), { shouldClearSourceFilter: false });

  assert.deepEqual(mod.resolveFeedDetailSourceContext({
    selectedIdFromRoute: null,
    querySourceId: '1354',
    itemSourceId: 786,
  }), { shouldClearSourceFilter: false });
});

test('keeps only reader-safe actions in the feed detail header', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedDetailHeaderActions({
    hasUrl: true,
    hasOriginalUrl: true,
    hasCurationUrl: true,
    hasAudio: true,
    hasAudioTask: true,
    needsFullTranslation: true,
    canReprocessAi: true,
    canEnrichContent: true,
  }), ['open_original', 'full_translation']);
});

test('moves repair and provenance actions into the feed reader tools menu', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedDetailToolActions({
    hasUrl: true,
    hasOriginalUrl: true,
    hasCurationUrl: true,
    hasAudio: true,
    hasAudioTask: true,
    needsFullTranslation: true,
    canReprocessAi: true,
    canEnrichContent: true,
  }), [
    'open_curation',
    'transcribe_audio',
    'open_audio_task',
    'reprocess_ai',
    'enrich_content',
  ]);
});

test('uses a reader-first tab order for feed details', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedReaderTabOrder(['summary', 'original', 'translation', 'qa', 'transcript', 'knowledge']), [
    'original',
    'translation',
  ]);
  assert.deepEqual(mod.resolveFeedSecondaryTabOrder(['summary', 'original', 'translation', 'qa', 'transcript', 'knowledge']), [
    'qa',
    'transcript',
    'knowledge',
  ]);
});

test('prefers a saved translated title while retaining the original title as context', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFeedDisplayTitle({
    title: 'The founder of Hinge raised $18M to build Overtone',
    translatedTitle: 'Hinge 创始人融资 1800 万美元打造 Overtone',
  }), {
    title: 'Hinge 创始人融资 1800 万美元打造 Overtone',
    originalTitle: 'The founder of Hinge raised $18M to build Overtone',
  });
  assert.deepEqual(mod.resolveFeedDisplayTitle({ title: '中文标题', translatedTitle: null }), {
    title: '中文标题',
    originalTitle: null,
  });
});

test('resolves the visible translation action from content readiness', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.resolveFeedTranslationAction({
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    contentEvidence: {
      primaryLayer: 'indexSummary',
      primaryLabel: '索引摘要',
      translationBasis: {
        layer: 'indexSummary',
        label: '索引摘要',
        reliableForFullTranslation: false,
        reason: '当前只有索引摘要；应先补抓原站正文再做全文翻译。',
      },
    },
    originalUrl: 'https://www.anthropic.com/news/tcs-anthropic-partnership',
    translationStatus: 'pending',
  }), 'fetch_then_translate');

  assert.equal(mod.resolveFeedTranslationAction({
    contentReadiness: {
      status: 'rss_summary',
      label: '外链摘要可读',
      basis: 'content',
      kind: 'external_link_summary',
      fullTextAvailable: false,
      originalTextStatus: 'pending_fetch',
      action: '这是来源站转引、摘录或评论的 RSS 正文，不等同于目标网页全文。',
    },
    contentEvidence: {
      primaryLayer: 'externalLinkSummary',
      primaryLabel: '外链摘要',
      translationBasis: {
        layer: 'externalLinkSummary',
        label: '外链摘要',
        reliableForFullTranslation: false,
        reason: '当前是来源站转引、摘录或评论的 RSS 正文；应先补抓目标网页正文再做全文翻译。',
      },
    },
    url: 'https://gizmodo.com/meta-has-a-ridiculous-amount-of-smart-glasses-planned-for-this-year-2000765741',
    translationStatus: 'ready',
  }), 'fetch_then_translate');

  assert.equal(mod.resolveFeedTranslationAction({
    contentReadiness: {
      status: 'rss_summary',
      label: '索引摘要可读',
      basis: 'content',
      kind: 'index_item',
      fullTextAvailable: false,
      originalTextStatus: 'pending_fetch',
      action: '已解析原站链接；建议补抓原文后再做深读、翻译或日报精选。',
    },
    originalUrl: 'https://www.anthropic.com/news/tcs-anthropic-partnership',
    translationStatus: 'skipped',
    translationReason: '原文已是中文',
  }), 'fetch_then_translate');

  assert.equal(mod.resolveFeedTranslationAction({
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    translationStatus: 'pending',
  }), 'translate');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'none',
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    translationStatus: 'ready',
    translationReason: null,
    aiTranslation: '标题：Quaternion Rotations, Claude, and Lean',
    translationCompleteness: {
      basisLength: 3200,
      translatedLength: 42,
      chunkCount: 2,
      complete: false,
      reason: '译文过短，建议补全译文。',
    },
  }), 'translate');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'none',
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'content',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    translationStatus: 'skipped',
    translationReason: '原文已是中文，无需翻译',
    aiTranslation: '',
  }), 'none');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'none',
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'readability',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    readabilityContent: 'This is a long English article about theorem proving, Claude, Lean, and quaternion rotations. '.repeat(80),
    language: 'en',
    translationStatus: 'skipped',
    translationReason: '原文已是中文，无需翻译',
    aiTranslation: '',
  }), 'translate');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'none',
    contentReadiness: {
      status: 'full_text',
      label: '全文可读',
      basis: 'readability',
      fullTextAvailable: true,
      originalTextStatus: 'ready',
      action: '可以直接阅读正文。',
    },
    readabilityContent: 'This is the actual long readable article with code and proof details. '.repeat(120),
    language: 'en',
    translationStatus: 'ready',
    aiTranslation: '这是一段明显短于原文的译文。',
  }), 'translate');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'none',
    contentReadiness: {
      status: 'rss_summary',
      label: '榜单摘要可读',
      basis: 'content',
      fullTextAvailable: false,
      originalTextStatus: 'missing_original_url',
      action: '可以先读榜单摘要；如需深读，需要先解析原站链接并补抓正文。',
    },
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      translationBasis: {
        reliableForFullTranslation: false,
        reason: '当前只有榜单摘要；没有原站正文时不应伪装成全文翻译。',
      },
    },
    url: 'https://www.bestblogs.dev/explore/brief',
    translationStatus: 'skipped',
    translationReason: '原文已是中文，无需翻译',
  }), 'open_original');

  assert.equal(mod.resolveFeedTranslationAction({
    translationAction: 'fetch_then_translate',
    contentReadiness: {
      status: 'rss_summary',
      label: '摘要片段可读',
      basis: 'snippet',
      fullTextAvailable: false,
      originalTextStatus: 'ready',
      action: '正文补抓未命中，当前只适合快扫；如需完整上下文，请打开原文。',
    },
    contentError: '正文抓取未命中，当前仅保留摘要片段',
    blockedReason: 'content_unavailable',
    readabilityStatus: 'failed',
    readabilityReason: '正文抓取未命中，当前仅保留摘要片段',
    url: 'https://36kr.com/newsflashes/3859408242004996?f=rss',
    translationStatus: 'pending',
  }), 'open_original');
});

test('uses the preferred readable source when labeling translation quality', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.resolveFeedTranslationStatusLabel({
    translationStatus: 'ready',
    aiTranslation: '这是一段很短的翻译。',
    sourceText: 'This is the actual long readable article text. '.repeat(120),
    translationUsable: false,
  }), '译文不完整，建议补全');

  assert.equal(mod.resolveFeedTranslationStatusLabel({
    translationStatus: 'ready',
    aiTranslation: '这是一段足够完整的中文翻译内容。',
    sourceText: 'Short source text.',
    translationUsable: true,
  }), '翻译已完成');
});

test('summarizes content evidence as a single low-noise reader notice', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'readableText',
      primaryLabel: '可读正文',
      translationBasis: {
        layer: 'readableText',
        label: '可读正文',
        reliableForFullTranslation: true,
        reason: '当前翻译可基于完整正文执行。',
      },
    },
  }), null);

  const indexNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'indexSummary',
      primaryLabel: '索引摘要',
      translationBasis: {
        layer: 'indexSummary',
        label: '索引摘要',
        reliableForFullTranslation: false,
        reason: '当前只有索引摘要；应先补抓原站正文再做全文翻译。',
      },
    },
  });
  assert.equal(indexNotice?.tone, 'warning');
  assert.match(indexNotice?.label || '', /索引摘要/);
  assert.match(indexNotice?.message || '', /先补抓原站正文/);
  assert.doesNotMatch(indexNotice?.message || '', /indexSummary|rawFeedHtml|translationBasis/);

  const curatedNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'curatedSummary',
      primaryLabel: '榜单摘要',
      translationBasis: {
        layer: 'curatedSummary',
        label: '榜单摘要',
        reliableForFullTranslation: false,
        reason: '当前只有榜单摘要；没有原站正文时不应伪装成全文翻译。',
      },
    },
  });
  assert.match(curatedNotice?.message || '', /榜单摘要/);

  const snapshotNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'snapshotText',
      primaryLabel: '网页快照',
      translationBasis: {
        layer: 'snapshotText',
        label: '网页快照',
        reliableForFullTranslation: false,
        reason: '当前是网页监控快照；不适合作为文章全文翻译依据。',
      },
    },
  });
  assert.match(snapshotNotice?.message || '', /网页监控快照/);

  const externalNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'externalLinkSummary',
      primaryLabel: '外链摘要',
      translationBasis: {
        layer: 'externalLinkSummary',
        label: '外链摘要',
        reliableForFullTranslation: false,
        reason: '当前是来源站转引、摘录或评论的 RSS 正文；应先补抓目标网页正文再做全文翻译。',
      },
    },
  });
  assert.equal(externalNotice?.tone, 'warning');
  assert.match(externalNotice?.label || '', /外链摘要/);
  assert.match(externalNotice?.message || '', /补抓目标网页正文/);
  assert.doesNotMatch(externalNotice?.message || '', /externalLinkSummary|translationBasis/);
});

test('renders curated index original content as a clean reader note instead of raw provenance metadata', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const display = mod.resolveFeedOriginalDisplayContent({
    sourceType: 'curated_index',
    sourceName: 'BestBlogs Daily Brief',
    contentReadiness: {
      fullTextAvailable: false,
      label: '榜单摘要可读',
      originalTextStatus: 'missing_original_url',
    },
    contentEvidence: {
      primaryLayer: 'curatedSummary',
    },
    content: [
      '## BestBlogs Daily Brief',
      '',
      '- 榜单日期：2026-06-16',
      '- 来源站点：OpenAI News',
      '- 榜单评分：93',
      '- 榜单详情：https://www.bestblogs.dev/article/example',
      '- 榜单页：https://www.bestblogs.dev/explore/brief',
      '',
      '## 榜单摘要',
      '',
      'OpenAI 发布了一个工程案例，介绍团队如何使用 Codex 改善开发工作流。',
      '',
      '## 原文待补抓',
      '',
      '当前条目来自 BestBlogs 每日精选榜单，原站链接尚未解析。',
    ].join('\n'),
  });

  assert.equal(display.renderMode, 'markdown');
  assert.match(display.content, /## 榜单摘要/);
  assert.match(display.content, /OpenAI 发布了一个工程案例/);
  assert.match(display.content, /## 原文待补抓/);
  assert.match(display.content, /原站链接尚未解析/);
  assert.doesNotMatch(display.content, /榜单详情/);
  assert.doesNotMatch(display.content, /https:\/\/www\.bestblogs\.dev/);
  assert.doesNotMatch(display.content, /榜单评分/);
});

test('renders external-link RSS summaries as pending target-body notes instead of fake full text', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const display = mod.resolveFeedOriginalDisplayContent({
    sourceType: 'rss',
    sourceName: 'daringfireball.net',
    contentReadiness: {
      fullTextAvailable: false,
      label: '外链摘要可读',
      originalTextStatus: 'pending_fetch',
    },
    contentEvidence: {
      primaryLayer: 'externalLinkSummary',
    },
    content: '<p>James Pero, summarizing for Gizmodo this paywalled report by Jyoti Mann for The Information:</p><blockquote>Meta has several smart glasses planned.</blockquote>',
  });

  assert.equal(display.renderMode, 'markdown');
  assert.match(display.content, /## 外链摘要/);
  assert.match(display.content, /James Pero/);
  assert.match(display.content, /## 目标正文待补抓/);
  assert.match(display.content, /不等同于目标网页全文/);
  assert.doesNotMatch(display.content, /<p>|<blockquote>/);
});

test('only surfaces warning-level evidence notices above the reading tabs', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const warningNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'indexSummary',
      primaryLabel: '索引摘要',
      translationBasis: {
        layer: 'indexSummary',
        label: '索引摘要',
        reliableForFullTranslation: false,
        reason: '当前只有索引摘要；应先补抓原站正文再做全文翻译。',
      },
    },
  });
  assert.equal(mod.shouldSurfaceFeedEvidenceNotice(warningNotice), true);

  const neutralNotice = mod.resolveFeedEvidenceNotice({
    contentEvidence: {
      primaryLayer: 'snippet',
      primaryLabel: '摘要片段',
      translationBasis: {
        layer: 'snippet',
        label: '摘要片段',
        reliableForFullTranslation: false,
        reason: '当前内容不足；需要先补正文。',
      },
    },
  });
  assert.equal(neutralNotice?.tone, 'neutral');
  assert.equal(mod.shouldSurfaceFeedEvidenceNotice(neutralNotice), false);
  assert.equal(mod.shouldSurfaceFeedEvidenceNotice(null), false);
});

test('uses user-facing labels for translation primary actions', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.feedTranslationActionLabel('fetch_then_translate'), '补抓原文并翻译');
  assert.equal(mod.feedTranslationActionLabel('translate'), '一键翻译全文');
  assert.equal(mod.feedTranslationActionLabel('open_original'), '打开原文');
});

test('only disables translation action for the item currently being translated', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.shouldDisableFeedTranslationAction({ itemId: 'a', stage: 'content' }, 'a'), false);
  assert.equal(mod.shouldDisableFeedTranslationAction({ itemId: 'b', stage: 'translation' }, 'a'), false);
  assert.equal(mod.shouldDisableFeedTranslationAction({ itemId: 'a', stage: 'translation' }, 'a'), true);
});

test('requests enrichment for ready RSS HTML rows missing readability text', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.shouldEnrichReadyHtmlWithoutReadability({
    contentStatus: 'ready',
    content: '<p>James Pero, summarizing for Gizmodo <a href="https://example.com">this report</a>.</p>',
    readabilityContent: null,
  }), true);

  assert.equal(mod.shouldEnrichReadyHtmlWithoutReadability({
    contentStatus: 'ready',
    content: '<p>Clean feed HTML.</p>',
    readabilityContent: 'Clean readable article body.',
  }), false);

  assert.equal(mod.shouldEnrichReadyHtmlWithoutReadability({
    contentStatus: 'ready',
    content: 'Plain text content without HTML tags.',
    readabilityContent: null,
  }), false);
});

test('only shows the feed content readiness banner when the reader needs an action or warning', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.shouldShowFeedContentReadinessBanner({
    status: 'full_text',
    label: '全文可读',
    fullTextAvailable: true,
    action: '可以直接阅读正文。',
  }), false);

  assert.equal(mod.shouldShowFeedContentReadinessBanner({
    status: 'rss_summary',
    label: '索引摘要可读',
    fullTextAvailable: false,
    action: '建议补抓原文后再翻译。',
  }), true);

  assert.equal(mod.shouldShowFeedContentReadinessBanner({
    status: 'fetch_failed',
    label: '补抓失败',
    fullTextAvailable: false,
    action: '重新补抓正文，或打开原文。',
  }), true);
});

test('normalizes full translation outcomes into visible reader notices', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.deepEqual(mod.resolveFullTranslationNotice({ translated: 1, skipped: 0, errors: [] }), {
    message: '精译全文完成，译文已刷新。',
    tone: 'success',
  });

  const failed = mod.resolveFullTranslationNotice({
    translated: 0,
    skipped: 0,
    errors: { translation: ['LLM 500'] },
  });
  assert.equal(failed.tone, 'danger');
  assert.match(failed.message, /LLM 500/);

  const skipped = mod.resolveFullTranslationNotice({ translated: 0, skipped: 1, errors: [] });
  assert.equal(skipped.tone, 'warning');
  assert.match(skipped.message, /被跳过/);
});

test('keeps full translation stage failures actionable for readers', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const contentFailed = mod.resolveFullTranslationNotice({
    stage: 'content',
    contentFetched: false,
    translated: 0,
    skipped: 0,
    errors: [],
    errorReason: '原站正文补抓失败：403 Forbidden',
  });
  assert.equal(contentFailed.tone, 'danger');
  assert.match(contentFailed.message, /补抓原文失败/);
  assert.match(contentFailed.message, /403 Forbidden/);
  assert.doesNotMatch(contentFailed.message, /精译全文失败/);

  const fetchedThenTranslated = mod.resolveFullTranslationNotice({
    stage: 'done',
    contentFetched: true,
    translated: 1,
    skipped: 0,
    errors: [],
  });
  assert.equal(fetchedThenTranslated.tone, 'success');
  assert.match(fetchedThenTranslated.message, /已补抓原文/);
  assert.match(fetchedThenTranslated.message, /译文已刷新/);

  const skippedWithReason = mod.resolveFullTranslationNotice({
    stage: 'translation',
    translated: 0,
    skipped: 1,
    errors: [],
    message: '全文翻译被跳过：当前没有可翻译正文。',
  });
  assert.equal(skippedWithReason.tone, 'warning');
  assert.equal(skippedWithReason.message, '全文翻译被跳过：当前没有可翻译正文。');
});

test('resolves completed translation from the refreshed item instead of stale queue progress', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  const completed = mod.resolveCompletedFullTranslationNotice({
    jobState: 'completed',
    message: '正在分块翻译全文。',
    translated: 0,
    item: {
      translationStatus: 'ready',
      aiTranslation: '这是已保存的完整中文译文。',
    },
  });

  assert.equal(completed.tone, 'success');
  assert.equal(completed.message, '全文翻译完成，译文已刷新。');
  assert.doesNotMatch(completed.message, /62%|正在/);

  const failed = mod.resolveCompletedFullTranslationNotice({
    jobState: 'completed',
    item: {
      translationStatus: 'failed',
      translationReason: '模型空响应',
    },
  });
  assert.equal(failed.tone, 'danger');
  assert.match(failed.message, /模型空响应/);

  const incomplete = mod.resolveCompletedFullTranslationNotice({
    jobState: 'completed',
    translated: 1,
    item: {
      translationStatus: 'ready',
      aiTranslation: '这是一段只覆盖开头的译文。',
      translationCompleteness: {
        complete: false,
        reason: '译文明显短于原文，可能只覆盖了开头部分。',
      },
    },
  });
  assert.equal(incomplete.tone, 'danger');
  assert.match(incomplete.message, /明显短于原文/);
});

test('collapses stale feed freshness into a compact inline status pill model', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(mod.resolveFeedFreshnessPill({ freshnessStatus: 'fresh' }), null);

  const stale = mod.resolveFeedFreshnessPill({
    freshnessStatus: 'stale',
    staleReason: '当前数据可能已经过期',
    lastSuccessfulFetchAt: '2026-06-18T02:30:00.000Z',
  });
  assert.equal(stale?.tone, 'danger');
  assert.equal(stale?.label, '数据已过期');
  assert.match(stale?.detail || '', /当前数据可能已经过期/);
  assert.match(stale?.actionLabel || '', /立即补抓/);

  const warning = mod.resolveFeedFreshnessPill({
    freshnessStatus: 'warning',
    staleReason: '存在 6 个到期来源待补抓',
  });
  assert.equal(warning?.tone, 'warning');
  assert.equal(warning?.label, '待补抓');
  assert.match(warning?.detail || '', /6 个到期来源/);
});

test('uses a fluid desktop reader shell while preserving the reading width preference', async () => {
  const mod = await import('../src/lib/feed-layout.ts');

  assert.equal(typeof mod.feedReaderBodyShellClassName, 'string');
  assert.match(mod.feedReaderBodyShellClassName, /max-w-none/);
  assert.match(mod.feedReaderBodyShellClassName, /2xl:grid-cols-\[minmax\(0,1fr\)_280px\]/);

  assert.equal(typeof mod.feedReaderMainColumnClassName, 'string');
  assert.match(mod.feedReaderMainColumnClassName, /max-w-\[var\(--reader-width\)\]/);
  assert.match(mod.feedReaderMainColumnClassName, /2xl:max-w-none/);
  assert.doesNotMatch(mod.feedReaderMainColumnClassName, /mb-16/);

  assert.equal(typeof mod.feedReaderSideRailClassName, 'string');
  assert.match(mod.feedReaderSideRailClassName, /w-full/);
  assert.match(mod.feedReaderSideRailClassName, /max-w-\[var\(--reader-width\)\]/);
  assert.match(mod.feedReaderSideRailClassName, /2xl:max-w-none/);
  assert.match(mod.feedReaderSideRailClassName, /2xl:mx-0/);
  assert.doesNotMatch(mod.feedReaderSideRailClassName, /sticky/);
});

test('loads feed detail once per route and does not silently batch reprocess visible items', () => {
  const pagePath = process.cwd().endsWith('/apps/web')
    ? join(process.cwd(), 'src/features/feed/FeedContext.tsx')
    : join(process.cwd(), 'apps/web/src/features/feed/FeedContext.tsx');
  const source = readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(source, /void handleEnrich\(selectedItem, \{ silent: true \}\)/);
  assert.doesNotMatch(source, /items\.find\(\(item\) => !autoEnrichedIds/);
  assert.match(source, /useFeedDetail\(effectiveDetailId\)/);
  assert.match(source, /\}, \[items, effectiveDetailId\]\);/);
});

test('default desktop Feed loads first detail while narrow screens retain the list', async () => {
  const { resolveFeedDetailId } = await import('../src/lib/feed-layout.ts');
  const items = [{ id: 'first' }, { id: 'second' }];
  assert.equal(resolveFeedDetailId(undefined, items, 1440), 'first');
  assert.equal(resolveFeedDetailId(undefined, items, 1280), 'first');
  assert.equal(resolveFeedDetailId(undefined, items, 1279), null);
  assert.equal(resolveFeedDetailId(undefined, items, 390), null);
  assert.equal(resolveFeedDetailId(undefined, [], 1440), null);
  assert.equal(resolveFeedDetailId('second', items, 390), 'second');
  assert.equal(resolveFeedDetailId('outside-list', items, 1440), 'outside-list');
});

test('default desktop reading stays on the selected article when the list reorders or drops it', async () => {
  const { resolveFeedDetailId } = await import('../src/lib/feed-layout.ts');
  for (const items of [[{ id: 'b' }, { id: 'a' }], [{ id: 'b' }], []]) {
    assert.equal(resolveFeedDetailId(undefined, items, 1440, 'a'), 'a');
  }
  assert.equal(resolveFeedDetailId('b', [{ id: 'a' }], 1440, 'a'), 'b');
  assert.equal(resolveFeedDetailId(undefined, [{ id: 'a' }], 390, 'a'), null);
});

test('auto-selects the first feed item on wide screens so the detail pane is not blank', async () => {
  const { shouldAutoSelectFirstFeedItem } = await import('../src/lib/feed-layout.ts');

  assert.equal(shouldAutoSelectFirstFeedItem({
    hasRouteId: false, hasSelectedItem: false, itemCount: 20, viewportWidth: 1600,
  }), true);
});

test('does not auto-select on narrow screens, where the list is a navigation step', async () => {
  const { shouldAutoSelectFirstFeedItem } = await import('../src/lib/feed-layout.ts');

  assert.equal(shouldAutoSelectFirstFeedItem({
    hasRouteId: false, hasSelectedItem: false, itemCount: 20, viewportWidth: 375,
  }), false);
});

test('does not auto-select when a route id or selection already exists, or the list is empty', async () => {
  const { shouldAutoSelectFirstFeedItem } = await import('../src/lib/feed-layout.ts');
  const wide = { viewportWidth: 1600 };

  assert.equal(shouldAutoSelectFirstFeedItem({ hasRouteId: true, hasSelectedItem: false, itemCount: 20, ...wide }), false);
  assert.equal(shouldAutoSelectFirstFeedItem({ hasRouteId: false, hasSelectedItem: true, itemCount: 20, ...wide }), false);
  assert.equal(shouldAutoSelectFirstFeedItem({ hasRouteId: false, hasSelectedItem: false, itemCount: 0, ...wide }), false);
});
