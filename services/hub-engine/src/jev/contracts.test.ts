import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES,validate,decide,publicUrl,diffText,reserveMicros,requestKey,type Scene } from './contracts.js';
import { callJev } from './client.js';
import { fixture } from './test-fixtures.js';

for(const scene of Object.keys(SCENES) as Scene[]){
 test(`${scene}: valid typed result and conservative insufficient path`,()=>{
  const raw=fixture(scene);assert.ok(decide(scene,validate(raw,scene)).action);
  (raw.answers.sufficient as any).noul=.79;
  assert.equal(decide(scene,validate(raw,scene)).action,'original');
 });
 test(`${scene}: malformed, nonfinite, wrong version and missing answers rejected`,()=>{
  const raw=fixture(scene);assert.throws(()=>validate({...raw,model:'latest'},scene));
  assert.throws(()=>validate({...raw,answers:{}},scene));
  (raw.answers.sufficient as any).noul=NaN;assert.throws(()=>validate(raw,scene));
 });
 test(`${scene}: provider failure never retries`,async()=>{
  let calls=0;await assert.rejects(callJev(scene,{},'test',async()=>{calls++;return new Response('',{status:429});}),/rate_limited/);assert.equal(calls,1);
 });
}
test('Choice and Score dictionaries must match all keys and conserve probability',()=>{
 const raw=fixture('feed');(raw.answers.topic as any).probabilities.other=.5;assert.throws(()=>validate(raw,'feed'));
 const score=fixture('daily');(score.answers.industry as any).score=3;assert.throws(()=>validate(score,'daily'));
});
test('Low confidence cannot route reduced processing',()=>{
 const r=fixture('enrichment');(r.answers.tier as any).confidence=.79;
 assert.equal(decide('enrichment',validate(r,'enrichment')).action,'original');
});
test('Middle probability keeps all monitor notifications',()=>{
 const r=fixture('monitor');(r.answers.substantial as any).noul=.5;
 assert.equal(decide('monitor',validate(r,'monitor')).action,'original');
});
test('Missing key and network failure do not leak response or retry',async()=>{
 let n=0;const fail=async()=>{n++;throw Error('SECRET_SENTINEL');};
 await assert.rejects(callJev('feed',{},'',fail),/missing_credential/);assert.equal(n,0);
 await assert.rejects(callJev('feed',{},'test',fail),e=>String(e)==='Error: request_unknown');assert.equal(n,1);
});
test('Public URL never accepts token URLs, local hosts or credentials',()=>{
 for(const url of ['http://127.0.0.1','http://10.2.3.4','http://[::1]','https://example.com?a=secret','https://user:pass@example.com','file:///a','http://host.internal'])assert.equal(publicUrl(url),false,url);
 assert.equal(publicUrl('https://example.com/article'),true);
});
test('Diff is bounded and preserves additions and removals',()=>{
 assert.deepEqual(diffText('a\nb','a\nc'),{removed:'b',added:'c',changed:true});
 assert.ok(diffText('a'.repeat(10000),'b'.repeat(10000)).added.length<=3000);
});
test('Revision keys include every semantic input and reserves are positive',()=>{
 assert.notEqual(requestKey('feed','a',{text:'old'}),requestKey('feed','a',{text:'new'}));
 assert.notEqual(requestKey('feed','a',{}),requestKey('daily','a',{}));assert.ok(reserveMicros({text:'中文'})>0);
});
