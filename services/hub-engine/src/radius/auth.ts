import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth, type AuthUser } from '../lib/auth.js';

// Dedicated integration key: only this router accepts it, and only for reads.
// Unlike a browser JWT, it never grants settings, source writes or paid research.
export function radiusAuth(c: Context, env: NodeJS.ProcessEnv = process.env): AuthUser {
  const file = env.RADIUS_READER_KEY_FILE;
  if (file && env.RADIUS_READER_USER_ID) {
    const expected = readFileSync(file,'utf8').trim();
    const actual = (c.req.header('authorization') || '').replace(/^Bearer\s+/i,'');
    const a=Buffer.from(actual),b=Buffer.from(expected);
    if (expected.length >= 32 && a.length === b.length && timingSafeEqual(a,b)) {
      const path=c.req.path.replace(/\/$/,'');
      const corpusRead=/\/radius\/(?:topics|sources|status|overview|(?:items|articles)\/[0-9a-f-]+)$/i.test(path);
      const allowed=(c.req.method==='GET' && corpusRead) || (c.req.method==='POST' && (path.endsWith('/radius/search')||path.endsWith('/radius/preview')));
      if (!allowed) throw new HTTPException(403,{message:'Radius integration key is read-only'});
      return {userId:env.RADIUS_READER_USER_ID,email:'',username:'radius-reader',role:'radius-reader'};
    }
  }
  return requireAuth(c);
}
