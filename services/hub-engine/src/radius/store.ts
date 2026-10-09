import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { excerpt, plainText, queryTerms, safeUrl, savedTopic, type SearchInput, type Topic, type TopicInput } from './contracts.js';

import { INDEX, MeiliClient } from './meili.js';
import {materialFromRow,publishedDate} from './material.js';

export class RadiusError extends Error {
  constructor(public code: string, public status: 400 | 403 | 404 | 409 | 503 = 400) { super(code); }
}
export type Executor = Pick<typeof db, 'execute' | 'transaction'>;
export class RadiusStore {
  constructor(private database: Executor = db, private client = new MeiliClient()) {}
  async topics(userId: string): Promise<Topic[]> {
    const rows = await this.database.execute(sql`select radius_topics from hub.user_settings where user_id=${userId}::uuid`);
    return savedTopic.array().parse(rows[0]?.radius_topics || []);
  }
  async save(userId: string, input: TopicInput, id?: string, version?: number) {
    return this.database.transaction(async tx => {
      await tx.execute(sql`insert into hub.user_settings(user_id) values(${userId}::uuid) on conflict(user_id) do nothing`);
      const rows = await tx.execute(sql`select radius_topics from hub.user_settings where user_id=${userId}::uuid for update`);
      const topics = savedTopic.array().parse(rows[0]?.radius_topics || []);
      const old = id ? topics.find(t => t.id === id) : undefined;
      if (id && !old) throw new RadiusError('topic_not_found', 404);
      if (old && old.version !== version) throw new RadiusError('topic_version_conflict', 409);
      if (!old && topics.length >= 100) throw new RadiusError('topic_limit_reached');
      if (topics.some(t => t.id !== id && t.name.toLowerCase() === input.name.toLowerCase())) throw new RadiusError('topic_name_exists', 409);
      if (input.sourceIds.length) {
        const ids = [...new Set(input.sourceIds)];
        const allowed = await tx.execute(sql`select id from hub.sources where user_id=${userId}::uuid and id in (${sql.join(ids.map(n => sql`${n}`), sql`,`)})`);
        if (allowed.length !== ids.length) throw new RadiusError('source_scope_denied', 403);
      }
      const now = new Date().toISOString();
      const topic: Topic = { ...input, sourceIds: [...new Set(input.sourceIds)], id: old?.id || randomUUID(), version: (old?.version || 0) + 1, createdAt: old?.createdAt || now, updatedAt: now };
      const updated = old ? topics.map(t => t.id === old.id ? topic : t) : [...topics, topic];
      await tx.execute(sql`update hub.user_settings set radius_topics=${JSON.stringify(updated)}::jsonb,updated_at=now() where user_id=${userId}::uuid`);
      return topic;
    });
  }
  async sources(userId: string) {
    return Array.from(await this.database.execute(sql`
      select s.id,s.name,s.status,s.source_type,s.source_role,s.trust_score,s.auto_fetch_enabled,
        s.last_fetched_at,s.last_success_at,s.last_outcome,
        count(i.id)::int as item_count,
        count(i.id) filter(where length(coalesce(i.transcript,''))>0)::int as transcript_count,
        count(i.id) filter(where (i.source_type='audio' or i.media_type in ('audio','video')) and length(coalesce(i.transcript,''))=0)::int as pending_transcript_count,
        count(i.id) filter(where i.published_at is null)::int as undated_count,
        min(coalesce(i.published_at,i.fetched_at)) as oldest_at,
        max(i.fetched_at) as newest_capture_at
      from hub.sources s left join hub.items i on i.source_id=s.id and i.user_id=${userId}::uuid
      where s.user_id=${userId}::uuid and coalesce(s.status,'active') <> 'removed'
      group by s.id order by s.name
    `));
  }
  async search(userId: string, input: SearchInput) {
    const topic = input.topicId ? (await this.topics(userId)).find(t => t.id === input.topicId) : undefined;
    if (input.topicId && !topic) throw new RadiusError('topic_not_found', 404);
    const sources = await this.sources(userId);
    let sourceIds = sources.map(s => Number(s.id));
    for (const ids of [input.sourceIds, topic?.sourceIds || []]) {
      if (ids.length) sourceIds = sourceIds.filter(id => ids.includes(id));
    }
    const empty = {items: [], total: 0, sources: [], offset: input.offset, limit: input.limit, topic: topic || null, mode: 'meilisearch',matching:input.matching,dateBasis:input.dateBasis, processingTimeMs: 0};
    if (!sourceIds.length) return empty;
    const filters = [`owner_id = ${JSON.stringify(userId)}`, `source_id IN [${sourceIds.join(',')}]`];
    if (topic) filters.push(`topic_ids = ${JSON.stringify(topic.id)}`);
    const dateField=input.dateBasis==='received'?'received_ts':'published_ts';
    if (input.from) filters.push(`${dateField} >= ${new Date(input.from + 'T00:00:00+08:00').getTime() / 1000}`);
    if (input.to) filters.push(`${dateField} < ${new Date(input.to + 'T00:00:00+08:00').getTime() / 1000 + 86400}`);
    const result = await this.client.request<{hits: Array<Record<string, unknown>>; totalHits: number; processingTimeMs: number; facetDistribution?: {source_id?: Record<string, number>}}>(`/indexes/${INDEX}/search`, 'POST', {
      q: input.q, matchingStrategy:input.matching==='broad'?'last':'all', filter: filters, hitsPerPage: input.limit, page: Math.floor(input.offset / input.limit) + 1,
      ...(input.sort === 'newest' ? {sort: [`${dateField}:desc`]} : {}),
      facets: ['source_id'], attributesToRetrieve: ['id','title','canonical_url','published_at','received_at','source_id','source_name','content_basis','is_filtered','content_hash','body_hash','qa_eligible','material_kind','material_label','text_chars','date_basis','source_role','trust_score'],
      attributesToCrop: ['content_text'], cropLength: 90,
    });
    // A stale search copy must never grant access to a removed or moved item.
    const hitIds = result.hits.map(h => String(h.id));
    const visible = hitIds.length ? await this.database.execute(sql`select i.id from hub.items i join hub.sources s on s.id=i.source_id where i.id in (${sql.join(hitIds.map(id => sql`${id}::uuid`),sql`,`)}) and i.user_id=${userId}::uuid and s.user_id=${userId}::uuid and coalesce(s.status,'active')<>'removed'`) : [];
    const allowed = new Set(visible.map(r => String(r.id)));
    return {
      ...empty,
      items: result.hits.filter(h => allowed.has(String(h.id))).map(h => ({
        ...h, id:String(h.id),source_id:Number(h.source_id),content_basis:String(h.content_basis),qa_eligible:h.qa_eligible===true,material_kind:String(h.material_kind||'unknown'),material_label:String(h.material_label||'待重新索引'),title:String(h.title||''),published_at:h.published_at?String(h.published_at):null, _formatted: undefined, url: safeUrl(h.canonical_url),
        excerpt: excerpt(plainText((h._formatted as {content_text?: string})?.content_text), queryTerms(input.q)),
        citation: `item:${h.id}`,
      })),
      total: result.totalHits, staleHitsRemoved: result.hits.length - allowed.size,
      sources: Object.entries(result.facetDistribution?.source_id || {}).map(([id,count]) => ({id: Number(id), name: sources.find(s => s.id === Number(id))?.name || id, count})),
      processingTimeMs: result.processingTimeMs,
      includesFiltered: true,
      matchNote:input.matching==='broad'?'已放宽关键词匹配，部分结果可能只命中部分词；不自动用于问答。':'每个检索词均须匹配；日期范围只使用指定的日期字段。',
      scopeNote: '已采集的关注源全文，包括未读和信息流过滤内容；收录不代表你已阅读或认同。',
    };
  }
  async status(userId: string) {
    const sources = await this.sources(userId);
    const [sync] = await this.database.execute(sql`select started_at,completed_at,document_count,task_id,error from hub.radius_sync where id=true`);
    const statistics = await this.client.request(`/indexes/${INDEX}/search`, 'POST', {q:'',filter:`owner_id = ${JSON.stringify(userId)}`,page:1,hitsPerPage:1,attributesToRetrieve:['id']});
    return {engine:'Meilisearch', indexedDocuments:Number(statistics.totalHits || 0), collectedDocuments:sources.reduce((n,s)=>n+Number(s.item_count),0), sourceCount:sources.length, sync:sync || null, sources, intervalSeconds:300};
  }
  async overview(userId: string) {
    const scope=sql`i.user_id=${userId}::uuid and s.user_id=${userId}::uuid and coalesce(s.status,'active')<>'removed'`;
    const [coverage]=await this.database.execute(sql`select count(*)::int as total,
      count(*) filter(where length(coalesce(nullif(i.readability_content,''),nullif(i.content,''),nullif(i.transcript,''),''))>0)::int as body_count,
      count(*) filter(where coalesce(i.author,'')<>'')::int as author_count,
      count(*) filter(where i.published_at is not null)::int as dated_count,
      count(*) filter(where i.readability_status='ready' and length(regexp_replace(coalesce(i.readability_content,''),'<[^>]*>','','g'))>=180)::int as extracted_count,
      count(*) filter(where length(coalesce(i.transcript,''))>0)::int as transcript_count,
      count(*) filter(where (i.source_type='audio' or i.media_type in ('audio','video')) and length(coalesce(i.transcript,''))=0)::int as pending_transcript_count,
      count(*) filter(where length(regexp_replace(coalesce(nullif(i.readability_content,''),nullif(i.content,''),nullif(i.transcript,''),''),'<[^>]*>','','g')) between 1 and 179)::int as short_count,
      count(*) filter(where i.fetched_at>=now()-interval '30 days')::int as recent_count
      from hub.items i join hub.sources s on s.id=i.source_id where ${scope}`);
    const timeline=await this.database.execute(sql`select to_char(i.fetched_at at time zone 'Asia/Shanghai','YYYY-MM-DD') as day,count(*)::int as count from hub.items i join hub.sources s on s.id=i.source_id where ${scope} and i.fetched_at>=now()-interval '30 days' group by day order by day`);
    return {coverage,timeline:Array.from(timeline),sources:await this.sources(userId)};
  }
  async article(userId:string,id:string) {
    const [row]=await this.database.execute(sql`select i.id,i.source_id,i.title,i.author,i.url,i.original_url,i.published_at,i.fetched_at,
      coalesce(nullif(i.readability_content,''),nullif(i.content,''),nullif(i.transcript,''),i.snippet,'') as content,
      case when length(coalesce(nullif(i.readability_content,''),nullif(i.content,''),nullif(i.transcript,''),''))>0 then 'body' else 'snippet' end as content_basis,
      i.ai_translation,i.ai_summary,i.summary_status,i.translation_status,s.name as source_name,i.source_type,
      i.readability_content,i.readability_status,i.transcript,i.media_type,i.media_url,i.audio_status,i.audio_task_id,i.snippet,s.source_role,s.trust_score
      from hub.items i join hub.sources s on s.id=i.source_id where i.id=${id}::uuid and i.user_id=${userId}::uuid and s.user_id=${userId}::uuid and coalesce(s.status,'active')<>'removed'`);
    if(!row)throw new RadiusError('item_not_found',404);
    return {...row,title:String(row.title||''),source_name:String(row.source_name||''),source_role:String(row.source_role||'normal'),fetched_at:row.fetched_at,...materialFromRow(row),published_at:publishedDate(row.published_at),id:String(row.id),source_id:Number(row.source_id),url:safeUrl(row.original_url)||safeUrl(row.url),original_url:undefined};
  }

  async read(userId: string, id: string, offset = 0, limit = 12000) {
    const article=await this.article(userId,id),body=article.content_text;
    return {id:article.id,title:article.title,url:article.url,published_at:article.published_at,fetched_at:article.fetched_at,
      source_name:article.source_name,source_role:article.source_role,material_kind:article.material_kind,material_label:article.material_label,qa_eligible:article.qa_eligible,
      body:body.slice(offset,offset+limit),offset,nextOffset:offset+limit<body.length?offset+limit:null,totalChars:body.length,citation:`item:${id}`};
  }
}
