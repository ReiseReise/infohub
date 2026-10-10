export type SourceTier = 'S' | 'A' | 'B' | 'C' | 'D';
export type SourceKind = 'official' | 'blog' | 'rss' | 'x' | 'wechat' | 'media' | 'api' | 'webpage' | 'podcast' | 'other';
export type ProcessingProfile = 'full' | 'smart' | 'brief' | 'monitor';
export type GrowthAxis = '认知升级' | '技术能力' | '商业判断' | '表达输出';
export type WebCaptureRenderMode = 'auto' | 'native' | 'dynamic' | 'stealth' | 'browser-assist';
export type BrowserAssistProvider = 'generic' | 'playwright' | 'agent-reach' | 'web-access';

export const SOURCE_TIER_OPTIONS: Array<{ value: SourceTier; label: string }> = [
  { value: 'S', label: 'S级信号' },
  { value: 'A', label: 'A级分析' },
  { value: 'B', label: 'B级资讯' },
  { value: 'C', label: 'C级噪声观察' },
  { value: 'D', label: 'D级哨兵' },
];

export const SOURCE_KIND_OPTIONS: Array<{ value: SourceKind; label: string }> = [
  { value: 'official', label: '官方/一手' },
  { value: 'blog', label: '博客/研究' },
  { value: 'rss', label: '通用 RSS' },
  { value: 'x', label: 'X/KOL' },
  { value: 'wechat', label: '公众号' },
  { value: 'media', label: '媒体/资讯' },
  { value: 'api', label: 'API' },
  { value: 'webpage', label: '网页监控' },
  { value: 'podcast', label: '播客/视频' },
  { value: 'other', label: '其他' },
];

export const PROCESSING_PROFILE_OPTIONS: Array<{ value: ProcessingProfile; label: string }> = [
  { value: 'full', label: '深加工' },
  { value: 'smart', label: '智能加工' },
  { value: 'brief', label: '轻摘要' },
  { value: 'monitor', label: '仅监控' },
];

export const GROWTH_AXIS_OPTIONS: GrowthAxis[] = ['认知升级', '技术能力', '商业判断', '表达输出'];

export const WEB_CAPTURE_MODE_OPTIONS: Array<{ value: WebCaptureRenderMode; label: string }> = [
  { value: 'auto', label: '自动回退' },
  { value: 'native', label: '原生优先' },
  { value: 'dynamic', label: '动态渲染优先' },
  { value: 'stealth', label: 'Stealth 优先' },
  { value: 'browser-assist', label: 'Browser Assist 优先' },
];

export const BROWSER_PROVIDER_OPTIONS: Array<{ value: BrowserAssistProvider; label: string }> = [
  { value: 'generic', label: '通用桥接' },
  { value: 'playwright', label: 'Playwright' },
  { value: 'agent-reach', label: 'Agent-Reach' },
  { value: 'web-access', label: 'web-access' },
];
