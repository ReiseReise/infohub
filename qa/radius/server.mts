// Local acceptance only: production routes, synthetic identity, no scheduler/model.
import {serve} from '../../services/hub-engine/node_modules/@hono/node-server/dist/index.mjs';
import {Hono} from '../../services/hub-engine/node_modules/hono/dist/index.js';
import radius from '../../services/hub-engine/src/routes/radius.js';
import {requireAuth} from '../../services/hub-engine/src/lib/auth.js';
if(process.env.DATABASE_URL!=='postgres://postgres:radius-qa-only@127.0.0.1:58229/radius_qa'||process.env.MEILI_URL!=='http://127.0.0.1:58230'||process.env.NODE_ENV!=='test')throw Error('isolated_targets_required');
const app=new Hono();
app.route('/api/radius',radius);
app.get('/api/auth/me',c=>{const user=requireAuth(c);return c.json({user:{id:user.userId,email:user.email,username:user.username,role:user.role}});});
app.get('/api/health',c=>c.json({status:'ok',environment:'radius-isolated-qa'}));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:58231});
console.log('Radius QA API on 127.0.0.1:58231');
process.on('SIGTERM',()=>server.close(()=>process.exit()));
