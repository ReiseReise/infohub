import type {
  ReferenceIntegrationStatus,
  ReferenceSourceCatalogItem,
  ReferenceSourceProvider,
} from './api';

export const REFERENCE_PROVIDER_LABELS: Record<ReferenceSourceProvider, string> = {
  qmreader: 'QMReader',
  follow_builders: 'Follow Builders',
  aihot: 'AI HOT',
  origin12: '源头信息员',
};

const CHANNEL_LABELS: Record<string, string> = {
  blog: '博客',
  news: '新闻',
  podcast: '播客',
  x: 'X 账号',
  wechat: '公众号',
  selected: '精选雷达',
  all: '公开全池',
  daily: '每日摘要',
  'ai-models': '模型',
  'ai-products': '产品',
  industry: '产业',
  paper: '论文',
  tip: '技巧',
  webpage_index: '网页索引',
  radar: '雷达',
  weekly: '周报',
  research_radar: '论文雷达',
  model_reality: '模型现实',
  infrastructure: '算力产业',
};

export function referenceChannelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] || channel || '其他';
}

export function referenceSourceState(item: ReferenceSourceCatalogItem): {
  label: string;
  tone: 'ready' | 'existing' | 'adapter' | 'reference';
} {
  if (item.alreadyAdded) return { label: '已加入', tone: 'existing' };
  if (item.canImport) return { label: '可选择', tone: 'ready' };
  if (item.importMode === 'adapter_required') return { label: '待适配', tone: 'adapter' };
  return { label: '仅记录', tone: 'reference' };
}

export function referenceIntegrationState(status: ReferenceIntegrationStatus): {
  label: string;
  tone: ReferenceIntegrationStatus;
} {
  if (status === 'shadow') return { label: '影子观察', tone: 'shadow' };
  if (status === 'active') return { label: '正式采纳', tone: 'active' };
  if (status === 'paused') return { label: '已暂停', tone: 'paused' };
  if (status === 'removed') return { label: '已移出', tone: 'removed' };
  return { label: '仅记录', tone: 'available' };
}

export function toggleReferenceSourceSelection(
  selected: string[],
  item: Pick<ReferenceSourceCatalogItem, 'key' | 'canImport'>,
  maxSelection: number,
): { selected: string[]; error: string | null } {
  if (selected.includes(item.key)) {
    return { selected: selected.filter((key) => key !== item.key), error: null };
  }
  if (!item.canImport) return { selected, error: '该来源当前不能直接导入' };
  if (selected.length >= maxSelection) {
    return { selected, error: `单次最多选择 ${maxSelection} 个来源` };
  }
  return { selected: [...selected, item.key], error: null };
}
