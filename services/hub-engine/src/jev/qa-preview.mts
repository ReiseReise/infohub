// Isolated browser acceptance only. Never loaded by production entrypoint.
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {jevStore} from './store.js';
import jev from '../routes/jev.js';
import auth from '../routes/auth.js';
import items from '../routes/items.js';
import sources from '../routes/sources.js';
import settings from '../routes/settings.js';
import {hashPassword} from '../lib/auth.js';
if(process.env.JEV_ISOLATED_TEST!=='1'||!process.env.DATABASE_URL?.includes('@127.0.0.1:58202/infohub'))throw Error('isolated_database_required');
const sql=jevStore().sql;
const [user]=await sql`select id from auth.users where username='Jev QA' order by created_at desc limit 1`;
await sql`update auth.users set email='jev-browser@example.invalid',password_hash=${await hashPassword('jev-qa-local-only')} where id=${user.id}`;
const app=new Hono();app.route('/api/auth',auth);app.route('/api/jev',jev);app.route('/api/items',items);app.route('/api/sources',sources);app.route('/api/settings',settings);
app.use('/*',serveStatic({root:'../../apps/web/dist'}));app.get('*',serveStatic({path:'../../apps/web/dist/index.html'}));
serve({fetch:app.fetch,port:3319,hostname:'127.0.0.1'});console.log('Jev isolated browser preview: http://127.0.0.1:3319/jev');
