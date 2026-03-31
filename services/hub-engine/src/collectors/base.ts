export interface RawItem {
  title: string;
  url: string;
  guid?: string;
  content?: string;
  author?: string;
  publishedAt?: Date;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video' | 'image';
  audioDuration?: number;
  rawData?: Record<string, unknown>;
}

export interface CollectorResult {
  items: RawItem[];
  fetchedAt: Date;
  error?: string;
  outcomeHint?: 'no_items' | 'no_change' | 'new_items' | 'error';
  sourceConfigPatch?: Record<string, unknown>;
}

export interface SourceConfig {
  id: number;
  name: string;
  sourceType: string;
  collectorType: string;
  config: Record<string, unknown>;
  category: string;
  priority: number;
  fetchInterval: number;
  status: string;
}

export interface Collector {
  readonly type: string;
  fetch(source: SourceConfig): Promise<CollectorResult>;
  healthCheck(): Promise<boolean>;
}
