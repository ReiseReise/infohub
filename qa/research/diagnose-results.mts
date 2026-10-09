import postgres from '../../services/hub-engine/node_modules/postgres/src/index.js';
import {parseModelJson} from '../../services/hub-engine/src/research/model.js';
import {draftSchema} from '../../services/hub-engine/src/research/contracts.js';
const url=new URL(process.env.RESEARCH_TEST_DATABASE_URL||'');if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/research_qa')throw new Error('isolated_database_required');
const sql=postgres(url.href);
try{
 const rows=await sql`select r.id,r.input->>'eventKey' as event,s.error,s.attempt,(select data from hub.research_run_log l where l.run_id=r.id and type='model_response' order by seq desc limit 1) as response from hub.research_runs r join hub.research_steps s on s.run_id=r.id where r.request_key like 'eval-v1:72b3d29530e7:%' and s.state='failed'`;
 for(const row of rows){const text=row.response?.text||'';let diagnostic:unknown;try{const value:any=parseModelJson(text);const parsed=draftSchema.safeParse(value);diagnostic={keys:Object.keys(value),draftErrors:parsed.success?[]:parsed.error.issues.map(i=>({code:i.code,path:i.path,message:i.message}))};}catch(e){diagnostic={error:e instanceof Error?e.message:String(e),tail:text.slice(-100)};}console.log(JSON.stringify({runId:row.id,event:row.event,error:row.error,attempt:row.attempt,length:text.length,stopReason:row.response?.stopReason,diagnostic}));}
}finally{await sql.end();}
