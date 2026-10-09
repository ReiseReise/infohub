WITH reports AS (
 SELECT date, summary, payload FROM hub.insights
 WHERE type='daily' AND date IN ('2026-09-06','2026-09-10','2026-09-13')
), material_ids AS (
 SELECT DISTINCT (t->>'id')::uuid id FROM reports, jsonb_array_elements(payload->'snapshot'->'topItems') t
)
SELECT jsonb_build_object('schemaVersion',1,'frozenAt',now(),'windows',(SELECT jsonb_agg(jsonb_build_object('date',date,'legacyMarkdown',summary,'snapshot',payload->'snapshot') ORDER BY date) FROM reports), 'materials',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'eventKey',coalesce(i.cluster_id,i.id::text),'title',i.title,'url',i.url,'originalUrl',i.original_url,'author',i.author,'publishedAt',i.published_at,'fetchedAt',i.fetched_at,'body',coalesce(nullif(i.readability_content,''),i.content,''),'summary',i.ai_summary,'sourceName',s.name) ORDER BY i.id) FROM hub.items i LEFT JOIN hub.sources s ON s.id=i.source_id WHERE i.id IN (SELECT id FROM material_ids)));
