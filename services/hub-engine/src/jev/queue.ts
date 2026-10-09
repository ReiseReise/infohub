import { Queue,Worker } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { hash, type Scene } from './contracts.js';
import { jevStore } from './store.js';
import { evaluate } from './service.js';
const u=new URL(config.redis.url);
const connection={host:u.hostname,port:Number(u.port||6379),password:u.password||undefined,db:Number(u.pathname.slice(1)||0),maxRetriesPerRequest:null};
let queue:Queue|undefined;
function getQueue(){return queue??=new Queue('jev-shadow',{connection,defaultJobOptions:{attempts:1,removeOnComplete:{count:1000},removeOnFail:{count:100}}});}
export async function enqueueJev(scene:Scene,target:string,peer?:string){
 if(process.env.JEV_ENABLED!=='true'||!config.ai.enabled)return {queued:false,reason:'global_disabled'};
 const store=jevStore(),c=await store.control();if(!c||c.stopped||c.modes[scene]!=='shadow')return {queued:false,reason:'scene_disabled'};
 // Do not put material, credentials, or private preferences in Redis.
 let revision='unavailable';try{revision=(await store.load(scene,target,peer)).revision;}catch{}
 await getQueue().add(scene,{scene,target,peer},{jobId:hash([scene,target,peer,revision])});
 return {queued:true,reason:null};
}
export function observeJev(scene:Scene,target:string,peer?:string){void enqueueJev(scene,target,peer).catch(()=>logger.warn('Jev observation unavailable; original flow unchanged'));}
export function observeNewItem(target:string){
 for(const scene of ['feed','enrichment','injection'] as Scene[])observeJev(scene,target);
 if(process.env.JEV_ENABLED==='true' && config.ai.enabled)void (async()=>{
  const store=jevStore();const peers=await store.sql`select b.id from hub.items a join hub.items b on b.cluster_id=a.cluster_id and b.id<>a.id where a.id::text=${target} order by b.published_at desc limit 3`;
  for(const p of peers)observeJev('same_event',target,p.id);
 })().catch(()=>logger.warn('Jev candidate lookup unavailable'));
}
export function startJevWorker(){
 if(process.env.JEV_ENABLED!=='true')return null;
 const worker=new Worker('jev-shadow',async job=>evaluate(jevStore(),job.data.scene,job.data.target,job.data.peer),{connection,concurrency:2,maxStalledCount:0});
 worker.on('error',()=>logger.warn('Jev worker unavailable; original flow unchanged'));
 return {close:async()=>{await worker.close();await queue?.close();await jevStore().sql.end();}};
}
