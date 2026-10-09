import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Hono} from 'hono';
import {radiusAuth} from './auth.js';
test('dedicated Agent key can search/read but cannot write topics or invoke paid services',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'radius-auth-')),file=join(dir,'key'),key='synthetic-reader-key-with-more-than-32-characters';
  writeFileSync(file,key,{mode:0o600});
  const env={RADIUS_READER_KEY_FILE:file,RADIUS_READER_USER_ID:'00000000-0000-4000-8000-000000000001'};
  const app=new Hono();app.all('*',c=>c.json({userId:radiusAuth(c,env).userId}));
  const headers={Authorization:'Bearer '+key};
  try {
    for(const [method,path,status] of [['GET','/api/radius/topics',200],['POST','/api/radius/search',200],['POST','/api/radius/preview',200],['POST','/api/radius/topics',403],['PUT','/api/radius/topics/id',403],['POST','/api/radius/runs',403],['POST','/api/radius/ask',403],['GET','/api/radius/questions',403]] as const) {
      assert.equal((await app.request(path,{method,headers})).status,status);
    }
    assert.equal((await app.request('/api/radius/topics',{headers:{Authorization:'Bearer wrong'}})).status,401);
  } finally {rmSync(dir,{recursive:true});}
});
