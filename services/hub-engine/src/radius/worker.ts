import postgres from 'postgres';
import { MeiliClient } from './meili.js';
import { syncRadius } from './sync.js';

if (process.env.RADIUS_SYNC_ENABLED !== 'true') throw new Error('radius_sync_not_enabled');
if (!process.env.DATABASE_URL) throw new Error('radius_database_not_configured');
const sql = postgres(process.env.DATABASE_URL, {max: 1});
const client = new MeiliClient();
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
while (!stopped) {
  try { console.log(JSON.stringify({event: 'radius_sync', ...await syncRadius(sql, client)})); }
  catch (e) { console.error(JSON.stringify({event: 'radius_sync_failed', error: (e as Error).message})); }
  if (process.argv.includes('--once')) break;
  for (let tick = 0; tick < 300 && !stopped; tick++) await new Promise(resolve => setTimeout(resolve, 1000));
}
await sql.end();
