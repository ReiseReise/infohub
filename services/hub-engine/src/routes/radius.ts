import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { radiusAuth as requireAuth } from '../radius/auth.js';
import { searchInput, topicInput } from '../radius/contracts.js';
import { RadiusError, RadiusStore } from '../radius/store.js';
import { MeiliError } from '../radius/meili.js';
import { askInput, questionSearch } from '../radius/question.js';
import {prepareEvidence,evidenceQuestion} from '../radius/evidence.js';
import { createRunSchema, fingerprint } from '../research/contracts.js';

export function createRadiusRoutes(store = new RadiusStore(), options: {checkModel?:()=>Promise<void>} = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => { requireAuth(c); await next(); });
  app.onError((e, c) => {
    if (e instanceof HTTPException) return e.getResponse();
    if (e instanceof RadiusError) return c.json({ error: e.code }, e.status);
    if (e instanceof MeiliError) return c.json({ error: e.code }, 503);
    if (e instanceof z.ZodError || e instanceof SyntaxError) return c.json({ error: 'radius_invalid_input' }, 400);
    const code = (e as { code?: string; cause?: {code?: string} }).code || (e as {cause?: {code?: string}}).cause?.code;
    if (code === '42703') return c.json({ error: 'radius_migration_required' }, 503);
    if (code === '57014') return c.json({ error: 'radius_query_timeout' }, 503);
    return c.json({ error: 'radius_service_unavailable' }, 503);
  });
  app.get('/topics', async c => c.json({ data: await store.topics(requireAuth(c).userId) }));
  app.post('/topics', async c => c.json({ data: await store.save(requireAuth(c).userId, topicInput.parse(await c.req.json())) }, 201));
  app.put('/topics/:id', async c => {
    const body = topicInput.extend({ version: z.number().int().positive() }).parse(await c.req.json());
    const { version, ...input } = body;
    return c.json({ data: await store.save(requireAuth(c).userId, input, z.string().uuid().parse(c.req.param('id')), version) });
  });
  app.get('/sources', async c => c.json({ data: await store.sources(requireAuth(c).userId) }));
  app.get('/status', async c => c.json({ data: await store.status(requireAuth(c).userId) }));
  app.get('/overview', async c => c.json({data:await store.overview(requireAuth(c).userId)}));
  app.get('/articles/:id', async c => c.json({data:await store.article(requireAuth(c).userId,z.string().uuid().parse(c.req.param('id')))}));
  app.get('/questions', async c => {
    const {researchStore}=await import('../research/store.js');
    const user=requireAuth(c);
    return c.json({data:await researchStore().sql`select id,question,state,created_at from hub.research_runs where requested_by=${user.userId} and input->>'corpus'='radius' order by created_at desc limit 20`});
  });
  app.post('/preview',async c=>{const input=askInput.parse(await c.req.json());const search=questionSearch(input);if(!search.q&&!search.topicId&&!input.itemIds.length)throw new RadiusError('radius_question_needs_subject');return c.json({data:await prepareEvidence(store,requireAuth(c).userId,input)});});
  app.post('/ask', async c => {
    if(process.env.TRUSTED_RESEARCH_ENABLED!=='true')throw new RadiusError('research_not_enabled',503);
    const user=requireAuth(c),input=askInput.parse(await c.req.json());
    const key='radius:'+z.string().min(1).max(100).parse(c.req.header('Idempotency-Key'));
    const {researchStore}=await import('../research/store.js');
    const research=researchStore(),hash=fingerprint(input);
    const [existing]=await research.sql`select id,input,policy from hub.research_runs where request_key=${user.userId+':'+key}`;
    if(existing){
      if(existing.input.radiusRequestHash!==hash)throw new RadiusError('idempotency_input_conflict',409);
      return c.json({data:{runId:existing.id,...existing.policy?.radius}},202);
    }
    const search=questionSearch(input);
    if(!search.q&&!search.topicId&&!input.itemIds.length)throw new RadiusError('radius_question_needs_subject');
    const plan=await prepareEvidence(store,user.userId,input);
    if(!plan.ready)return c.json({data:{runId:null,...plan}});
    const {resolveResearchKey,assertResearchPricing}=await import('../research/model.js');
    try{if(options.checkModel)await options.checkModel();else {assertResearchPricing();await resolveResearchKey(research);}}catch(e){throw new RadiusError((e as {code?:string}).code||'model_configuration_unavailable',503);}
    const question=evidenceQuestion(input,plan);
    const run=await research.create(user.userId,key,createRunSchema.parse({kind:'topic',question,sourceIds:plan.items.map(x=>x.id),scope:'selected',corpus:'radius',radiusRequestHash:hash,network:false}));
    const {items: _items,...summary}=plan;
    const metadata={...summary,groups:plan.groups.map(({selected,...group})=>({...group,itemIds:selected.map(x=>x.id)})),question:input.question};
    await research.sql`update hub.research_runs set policy=policy||${research.sql.json({radius:metadata})}::jsonb where id=${run.id}`;
    return c.json({data:{runId:run.id,...metadata}},202);
  });
  app.post('/search', async c => c.json({ data: await store.search(requireAuth(c).userId, searchInput.parse(await c.req.json())) }));
  app.get('/items/:id', async c => c.json({ data: await store.read(requireAuth(c).userId,
    z.string().uuid().parse(c.req.param('id')),
    z.coerce.number().int().min(0).max(20000000).parse(c.req.query('offset') || 0),
    z.coerce.number().int().min(100).max(20000).parse(c.req.query('limit') || 12000)) }));
  return app;
}
export default createRadiusRoutes();
