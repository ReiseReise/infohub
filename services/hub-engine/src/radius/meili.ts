import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { plainText, safeUrl, type Topic } from './contracts.js';
import {materialFromRow,publishedDate} from './material.js';

export const INDEX = 'infohub_radius';
export class MeiliError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}
export class MeiliClient {
  constructor(private url = process.env.MEILI_URL || '', private key = process.env.MEILI_API_KEY || (process.env.MEILI_KEY_FILE ? readFileSync(process.env.MEILI_KEY_FILE, 'utf8').trim() : ''), private fetcher: typeof fetch = fetch) {}
  async request<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.url || !this.key) throw new MeiliError('radius_search_not_configured');
    const response = await this.fetcher(this.url.replace(/\/$/, '') + path, {
      method, redirect: 'error', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as {code?: string};
      throw new MeiliError(error.code || 'radius_search_unavailable', response.status);
    }
    return response.json() as Promise<T>;
  }
  async wait(taskUid: number) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const task = await this.request<{status: string; error?: {code?: string}}>(`/tasks/${taskUid}`);
      if (task.status === 'succeeded') return;
      if (['failed', 'canceled'].includes(task.status)) throw new MeiliError(task.error?.code || 'radius_index_task_failed');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new MeiliError('radius_index_task_timeout');
  }
  async mutate(path: string, method: string, body: unknown) {
    const task = await this.request<{taskUid: number}>(path, method, body);
    await this.wait(task.taskUid);
    return task.taskUid;
  }
  async prepare() {
    try { await this.request(`/indexes/${INDEX}`); }
    catch (e) {
      if (!(e instanceof MeiliError) || e.code !== 'index_not_found') throw e;
      await this.mutate('/indexes', 'POST', {uid: INDEX, primaryKey: 'id'});
    }
    await this.mutate(`/indexes/${INDEX}/settings`, 'PATCH', {
      searchableAttributes: ['title', 'content_text', 'author', 'source_name'],
      filterableAttributes: ['owner_id', 'source_id', 'topic_ids', 'published_ts', 'received_ts', 'generation', 'content_basis', 'is_filtered', 'qa_eligible', 'material_kind'],
      sortableAttributes: ['published_ts','received_ts'],
      pagination: {maxTotalHits: 100000},
    });
  }
}
export function documentFromRow(row: Record<string, unknown>, topics: Topic[], generation: string) {
  const material=materialFromRow(row),text=material.content_text;
  const title = plainText(row.title);
  const haystack = (title + '\n' + text).toLowerCase();
  const matches = topics.filter(t => !t.archived && (!t.sourceIds.length || t.sourceIds.includes(Number(row.source_id))) && t.terms.some(term => haystack.includes(term.toLowerCase())) && !t.exclude.some(term => haystack.includes(term.toLowerCase())));
  const published=publishedDate(row.published_at),received=publishedDate(row.fetched_at);
  return {
    id: String(row.id), owner_id: String(row.user_id), source_id: Number(row.source_id), source_name: String(row.source_name),
    title, ...material, author: plainText(row.author), canonical_url: safeUrl(row.original_url) || safeUrl(row.url),
    published_at: published, published_ts: published?Math.floor(new Date(published).getTime()/1000):null,
    date_basis: published?'published':'unknown',
    received_at:received,received_ts:received?Math.floor(new Date(received).getTime()/1000):null,
    source_role:String(row.source_role||'normal'),trust_score:Number(row.trust_score||0),
    is_filtered: Boolean(row.is_filtered), topic_ids: matches.map(t => t.id), generation,
    body_hash:createHash('sha256').update(text).digest('hex'),
    content_hash: createHash('sha256').update(title + '\n' + text).digest('hex'),
  };
}
