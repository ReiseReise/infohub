import test from 'node:test';
import assert from 'node:assert/strict';
import {askInput,questionSearch,questionKeywords,selectQuestionSources} from './question.js';
test('natural question extracts subject and bounds recent window in Shanghai dates',()=>{
  const q=questionSearch(askInput.parse({question:'最近腾讯在我关注的信源里，风评如何？'}),new Date('2026-09-29T08:00:00Z'));
  assert.equal(q.q,'腾讯');assert.equal(q.from,'2026-08-31');assert.equal(q.to,'2026-09-29');
  assert.match(questionKeywords('AI Agent 的讨论有哪些变化？'),/AI Agent/);
});
test('explicit keywords and scopes survive question planning; followups retain subject',()=>{
  const q=questionSearch(askInput.parse({question:'最近腾讯如何？',keywords:'Hunyuan',sourceIds:[9],from:'2026-09-01',to:'2026-09-20'}));
  assert.equal(q.q,'Hunyuan');assert.deepEqual(q.sourceIds,[9]);assert.equal(q.from,'2026-09-01');
  const follow=questionSearch(askInput.parse({question:'那它有哪些争议？',previousQuestion:'腾讯的 AI 产品怎么样？'}));assert.match(follow.q,/腾讯/);
});
test('candidate sampling preserves filtered original material and diversifies sources',()=>{
  const input=Array.from({length:10},(_,i)=>({id:String(i),source_id:i<6?1:2,content_basis:i===9?'snippet':'body',is_filtered:i===0}));
  const selected=selectQuestionSources(input,5);assert.equal(selected.length,5);assert.ok(selected.some(x=>x.source_id===2));assert.ok(selected.some(x=>x.is_filtered));assert.ok(!selected.some(x=>x.id==='9'));
});
test('calendar and rolling periods do not leak temporal tokens into the subject',()=>{
  const now=new Date('2026-10-02T02:00:00Z');
  const recent=questionSearch(askInput.parse({question:'近一个月，AI Agent 的讨论有哪些变化？'}),now);
  assert.equal(recent.q,'AI Agent');assert.equal(recent.from,'2026-09-03');
  const month=questionSearch(askInput.parse({question:'上个月腾讯的风评如何？'}),now);
  assert.equal(month.q,'腾讯');assert.equal(month.from,'2026-09-01');assert.equal(month.to,'2026-09-30');
  const week=questionSearch(askInput.parse({question:'上周腾讯有哪些进展？'}),now);
  assert.equal(week.from,'2026-09-21');assert.equal(week.to,'2026-09-27');
  assert.equal(questionSearch(askInput.parse({question:'昨天腾讯如何？'}),new Date('2026-10-01T17:00:00Z')).from,'2026-10-01');
});
test('duplicate URLs and copied content do not consume evidence slots',()=>{
 const rows=[{id:'a',source_id:1,content_basis:'body',url:'https://example.com/a?utm_source=rss',content_hash:'same'},
 {id:'b',source_id:2,content_basis:'body',url:'https://example.com/a',content_hash:'other'},
 {id:'c',source_id:3,content_basis:'body',url:'https://other.com/a',content_hash:'same'},
 {id:'d',source_id:3,content_basis:'body',url:'https://other.com/b',content_hash:'unique'}];
 assert.deepEqual(selectQuestionSources(rows).map(x=>x.id),['a','d']);
});
