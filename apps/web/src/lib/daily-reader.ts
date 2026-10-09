import type { DailyReportCoverageItem, DailyReportLatestPayload } from './api/contracts';

export type DailyReaderNavItem = {
  id: string;
  label: string;
  level: 2 | 3;
};

export function reportHeadingId(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized ? `report-${normalized}` : '';
}

function normalizeHeadingLabel(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function stripLeadingDuplicateMarkdownHeading(markdown: string | null | undefined, expectedHeading: string) {
  const value = (markdown || '').trim();
  if (!value) return '';
  const lines = value.split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return '';
  const match = lines[firstContentIndex].trim().match(/^#{1,6}\s+(.+)$/);
  if (!match) return value;

  const actual = normalizeHeadingLabel(match[1]);
  const expected = normalizeHeadingLabel(expectedHeading);
  if (!actual || !expected || actual !== expected) return value;

  const rest = lines.slice(firstContentIndex + 1);
  while (rest.length > 0 && rest[0].trim() === '') rest.shift();
  return rest.join('\n').trim();
}

export function extractReportNavFromMarkdown(markdown: string, limit = 16): DailyReaderNavItem[] {
  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^(#{2,3})\s+(.+)$/);
      if (!match) return null;
      const label = match[2].trim();
      const level = match[1].length === 2 ? 2 : 3;
      return { id: reportHeadingId(label), label, level };
    })
    .filter((item): item is DailyReaderNavItem => Boolean(item?.label && item.id))
    .slice(0, limit);
}

export function resolveDailyCoverageItemHref(item: Pick<DailyReportCoverageItem, 'id' | 'url'>) {
  if (item.id) return `/feed/${encodeURIComponent(item.id)}`;
  return /^https?:\/\//i.test(item.url || '') ? item.url : null;
}

export function stripDailyReportArticleFrontMatter(markdown: string) {
  return markdown
    .replace(/## 收集趋势[\s\S]*?(?=\n## (?!收集趋势)|$)/, '')
    .replace(/## 信息雷达总览[\s\S]*?(?=\n## (?!信息雷达总览)|$)/, '')
    .replace(/## 今日重点文章[\s\S]*?(?=\n## (?!今日重点文章)|$)/, '')
    .replace(/## 今日精选[\s\S]*?(?=\n## (?!今日精选)|$)/, '')
    .replace(/## 模块日报[\s\S]*?(?=\n## (?!模块日报)|$)/, '')
    .trim();
}

export function stripDailyFinishedReportFrontMatter(markdown: string) {
  return markdown
    .replace(/^\s*#\s+[^\n]+\n+/, '')
    .replace(/^\s*(?:>[^\n]*\n?)+\s*/, '')
    .replace(/(?:^|\n)## 今日封面判断[\s\S]*?(?=\n## |$)/, '')
    .replace(/(?:^|\n)## 目录[\s\S]*?(?=\n## |$)/, '')
    .trim();
}

export function buildDailyFinishedReaderNav(
  data: DailyReportLatestPayload | null | undefined,
  finishedMarkdown: string,
) {
  const degraded = data?.qualityStatus === 'degraded';
  const cover = data && !data.missing
    ? [{
      id: reportHeadingId(degraded ? '可核验事实' : '今日封面判断'),
      label: degraded ? '可核验事实' : '今日封面判断',
      level: 2 as const,
    }]
    : [];
  // Read enough headings before dropping article-level H3 entries. Slicing first
  // made long reports lose every section after the first few article headings.
  const extractedItems = extractReportNavFromMarkdown(finishedMarkdown, 128)
    .filter((item) => !/^(?:目录|今日封面判断|可核验事实)$/.test(item.label));
  const levelTwoCount = extractedItems.filter((item) => item.level === 2).length;
  const markdownItems = levelTwoCount >= 3
    ? extractedItems.filter((item) => item.level === 2)
    : extractedItems;
  const seen = new Set<string>();
  const items = [...cover, ...markdownItems].filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return (items.length > 0 ? items : buildDailyReaderNav(data, finishedMarkdown)).slice(0, 16);
}

export function resolveDailyReportEntryCount(data?: DailyReportLatestPayload | null): number {
  if (!data) return 0;
  if (resolveDailyPublicationStatus(data) === 'published' && Array.isArray(data.editorialDigest?.curated)) {
    return data.editorialDigest.curated.length;
  }
  if (typeof data.coverageSummary?.selected === 'number' && Number.isFinite(data.coverageSummary.selected)) {
    return data.coverageSummary.selected;
  }
  if (Array.isArray(data.coverageItems) && data.coverageItems.length > 0) {
    const selected = data.coverageItems.filter((item) => item.status === 'selected').length;
    if (selected > 0) return selected;
  }
  if (typeof data.coverageDiagnostics?.finalCandidates === 'number' && Number.isFinite(data.coverageDiagnostics.finalCandidates)) {
    return data.coverageDiagnostics.finalCandidates;
  }
  const payload = data.payload as {
    snapshot?: { candidateFunnel?: { finalCandidates?: unknown } };
    workflow?: { funnel?: { finalCandidates?: unknown } };
  } | undefined;
  const finalCandidates = payload?.snapshot?.candidateFunnel?.finalCandidates ?? payload?.workflow?.funnel?.finalCandidates;
  if (typeof finalCandidates === 'number' && Number.isFinite(finalCandidates)) {
    return finalCandidates;
  }
  return typeof data.itemCount === 'number' && Number.isFinite(data.itemCount) ? data.itemCount : 0;
}

export function resolveDailyPublicationStatus(data?: DailyReportLatestPayload | null) {
  if (!data || data.missing || data.publicationStatus === 'missing') return 'missing' as const;
  if (data.publicationStatus === 'published' || data.publishable === true) return 'published' as const;
  if (data.publicationStatus === 'draft' || data.qualityStatus === 'degraded') return 'draft' as const;
  if (data.qualityStatus === 'full') return 'published' as const;
  // Legacy API snapshots predate publicationStatus. A non-empty markdown body
  // remains readable unless the server explicitly marks the run as degraded.
  return data.markdown?.trim() ? 'published' as const : 'draft' as const;
}

export function resolveDailyPublicationLabel(data?: DailyReportLatestPayload | null) {
  const status = resolveDailyPublicationStatus(data);
  if (status === 'published') return '正式编辑稿';
  if (status === 'draft') return '待发布草稿';
  return '尚未生成';
}

export function shouldRenderPublishedDailyReport(data?: DailyReportLatestPayload | null) {
  return resolveDailyPublicationStatus(data) === 'published' && Boolean(data?.markdown?.trim());
}

export function resolveDailyDraftMarkdown(data?: DailyReportLatestPayload | null) {
  if (resolveDailyPublicationStatus(data) !== 'draft') return '';
  return String(data?.draft?.markdown || '').trim();
}

export function buildDailyLatestTopMetrics(data: DailyReportLatestPayload, navCount: number) {
  const publicationStatus = resolveDailyPublicationStatus(data);
  const degraded = publicationStatus === 'draft';
  return [
    { label: '日期', value: data.date },
    { label: '生成时间', value: data.generatedAt || '' },
    { label: degraded ? '主候选' : '正式入报', value: resolveDailyReportEntryCount(data) },
    { label: '报告状态', value: publicationStatus === 'published' ? '已发布' : publicationStatus === 'draft' ? '待发布' : '未生成' },
    { label: '阅读导航', value: navCount },
  ];
}

export function resolveDailyReportTitle(data?: DailyReportLatestPayload | null) {
  if (resolveDailyPublicationStatus(data) === 'draft') {
    return data?.date ? `${data.date} 正式日报尚未发布` : '正式日报尚未发布';
  }
  const editorialTitle = data?.markdown?.match(/^#\s+([^\n]+)$/m)?.[1]?.trim();
  if (editorialTitle) return editorialTitle;
  const coverTitle = data?.coverJudgement?.title?.trim();
  if (coverTitle && !/^(信息中枢日报|高质量日报|日报)$/i.test(coverTitle)) {
    return coverTitle;
  }
  return data?.reportScope?.label || '信息中枢日报';
}

export function resolveDailyReportLead(data?: DailyReportLatestPayload | null) {
  if (!data) return '这是一份按趋势、重点文章、模块证据和全池索引组织的日报阅读稿。';
  if (data.missing) {
    const scope = data.reportScope?.sourceName ? `「${data.reportScope.sourceName}」` : '当前范围';
    return `${scope}还没有生成正式日报。生成完成后，这里会显示封面判断、信息雷达、重点文章、模块日报和全池索引。`;
  }
  if (resolveDailyPublicationStatus(data) === 'draft') {
    return data.qualityReasonLabel
      ? `本次生成没有通过质量门禁：${data.qualityReasonLabel} 素材草稿已经保留，但不会冒充正式日报。`
      : '本次生成没有通过质量门禁。素材草稿已经保留，但不会冒充正式日报。';
  }
  return data.markdown?.match(/^>\s+([^\n]+)$/m)?.[1]?.trim() || data.coverJudgement?.summary || '';
}

export function dailyReportScopedPath(path: string, date = '', sourceId = '') {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (sourceId) query.set('sourceId', sourceId);
  return query.size ? `${path}?${query.toString()}` : path;
}

export function dailyReportReadingStats(markdown: string) {
  const articleIds = new Set([...markdown.matchAll(/\]\(\/feed\/([^)?#\s]+)[^)]*\)/g)].map((match) => match[1]));
  const text = markdown.replace(/\]\([^)]*\)/g, ']').replace(/[#*_>]/g, '');
  const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.match(/[a-zA-Z]+/g) || []).length;
  return { articles: articleIds.size, minutes: Math.max(1, Math.ceil(chinese / 450 + words / 220)) };
}

export function buildDailyReportDeck(data?: DailyReportLatestPayload | null) {
  if (!data) return [];
  if (data.missing) {
    return [
      data.date ? `日期 ${data.date}` : '',
      data.reportScope?.sourceId ? '来源日报' : '全局日报',
      '未生成',
    ].filter(Boolean);
  }
  const selected = resolveDailyReportEntryCount(data);
  const modules = data.moduleSections?.length || data.moduleNarratives?.length || 0;
  const dynamics = (data.moreDynamics?.length || 0) + (data.deepReads?.length || 0);
  const coverage = data.coverageSummary?.total || data.coverageItems?.length || 0;
  const degraded = resolveDailyPublicationStatus(data) === 'draft';
  if (degraded) {
    return [
      data.date ? `日期 ${data.date}` : '',
      '质量门禁未通过',
      data.draft?.markdown?.trim() ? '草稿已保留' : '无可用草稿',
    ].filter(Boolean);
  }
  return [
    data.date ? `日期 ${data.date}` : '',
    selected ? `精选 ${selected} 篇` : '',
    modules ? `模块 ${modules} 组` : '',
    !degraded && dynamics ? `补充动态 ${dynamics} 条` : '',
    coverage ? `覆盖 ${coverage} 条候选` : '',
  ].filter(Boolean);
}

export function shouldRenderDailyLongformArticle(data?: DailyReportLatestPayload | null, articleMarkdown?: string | null) {
  const markdown = (articleMarkdown || '').trim();
  if (!markdown) return false;
  const hasStructuredNarrative = Boolean(
    data?.coverJudgement
    || data?.radarOverview?.markdown
    || data?.priorityArticles?.length
    || data?.moduleSections?.length
    || data?.moreDynamics?.length
    || data?.deepReads?.length,
  );
  if (hasStructuredNarrative) return false;
  return markdown.length > 40;
}

export function mergeDailyModuleEvidenceLinks(
  section: NonNullable<DailyReportLatestPayload['moduleSections']>[number],
  limit = 6,
) {
  const seen = new Set<string>();
  return [
    ...(section.primaryLinks || []),
    ...(section.priorityArticles || []),
    ...(section.secondaryLinks || []),
  ].filter((item) => {
    const key = item.url || item.id || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function buildDailySupplementalMaterials(data?: DailyReportLatestPayload | null) {
  if (!data?.editorialMaterials?.length) return [];
  const seen = new Set<string>();
  const remember = (id?: string | null, url?: string | null) => {
    if (id) seen.add(`id:${id}`);
    if (url) seen.add(`url:${url}`);
  };
  for (const article of data.priorityArticles || []) remember(article.id, article.url);
  for (const section of data.moduleSections || []) {
    for (const article of section.priorityArticles || []) remember(article.id, article.url);
    for (const evidence of section.evidence || []) remember(evidence.itemId, evidence.url);
  }
  return data.editorialMaterials.filter((material) => {
    if (!/^https?:\/\//i.test(material.evidenceUrl || '')) return false;
    const idKey = material.itemId ? `id:${material.itemId}` : '';
    const urlKey = `url:${material.evidenceUrl}`;
    if ((idKey && seen.has(idKey)) || seen.has(urlKey)) return false;
    if (idKey) seen.add(idKey);
    seen.add(urlKey);
    return true;
  });
}

export function buildDailyReaderNav(data?: DailyReportLatestPayload | null, fallbackMarkdown = ''): DailyReaderNavItem[] {
  if (!data) return extractReportNavFromMarkdown(fallbackMarkdown);
  const items: DailyReaderNavItem[] = [];
  const degraded = data.qualityStatus === 'degraded';
  if (data.coverJudgement) items.push({ id: reportHeadingId(degraded ? '可核验事实' : '今日封面判断'), label: degraded ? '可核验事实' : '今日封面判断', level: 2 });
  if (data.priorityArticles?.length) items.push({ id: reportHeadingId(degraded ? '可核验重点材料' : '今日重点文章'), label: degraded ? '可核验重点材料' : '今日重点文章', level: 2 });
  if (degraded && data.trendSummary) {
    items.push({ id: reportHeadingId('采集事实'), label: '采集事实', level: 2 });
  } else if (data.radarOverview?.markdown) {
    items.push({ id: reportHeadingId('信息雷达总览'), label: '信息雷达总览', level: 2 });
  }
  if (data.moduleSections?.length) {
    items.push({ id: reportHeadingId(degraded ? '分模块事实' : '模块日报'), label: degraded ? '分模块事实' : '模块日报', level: 2 });
    data.moduleSections
      .filter((section) => section.narrativeMarkdown || section.priorityArticles?.length || section.conclusion)
      .slice(0, 8)
      .forEach((section) => {
        items.push({
          id: reportHeadingId(section.editorialTitle || section.title),
          label: section.editorialTitle || section.title,
          level: 3,
        });
      });
  }
  if (degraded && buildDailySupplementalMaterials(data).length) items.push({ id: reportHeadingId('补充事实线索'), label: '补充事实线索', level: 2 });
  if (!degraded && data.moreDynamics?.length) items.push({ id: reportHeadingId('更多动态'), label: '更多动态', level: 2 });
  if (!degraded && data.deepReads?.length) items.push({ id: reportHeadingId('重点研究/深读'), label: '重点研究/深读', level: 2 });
  if (data.readingOrder?.markdown) items.push({ id: reportHeadingId('阅读顺序'), label: '阅读顺序', level: 2 });
  if (data.nextActions?.markdown) items.push({ id: reportHeadingId('下一步行动'), label: '下一步行动', level: 2 });
  if (degraded) items.push({ id: reportHeadingId('素材缺口'), label: '素材缺口', level: 2 });
  if (data.coverageItems?.length) items.push({ id: reportHeadingId('附录：全池摘要索引'), label: '附录：全池摘要索引', level: 2 });
  return items.length > 0 ? items : extractReportNavFromMarkdown(fallbackMarkdown);
}
