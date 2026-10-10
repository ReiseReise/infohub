import test from 'node:test';import assert from 'node:assert/strict';
import {radiusDraftIssues} from './answer-policy.js';
const citation='00000000-0000-4000-8000-000000000001';
const fact={text:'材料称尝试访问系统，未证实成功入侵。',citations:[citation]};
test('radius answer rejects raw evidence IDs in prose and article-catalog dumps',()=>{
 assert.deepEqual(radiusDraftIssues({title:'回答',facts:[fact],analysis:[fact],unresolved:['样本不代表整体舆论。']},[citation]),[]);
 assert.ok(radiusDraftIssues({title:'回答',facts:[{...fact,text:`材料内容[${citation}]`}],analysis:[],unresolved:[]},[citation]).includes('radius_citation_ids_belong_in_citations_only'));
 assert.ok(radiusDraftIssues({title:'目录',facts:Array.from({length:12},()=>fact),analysis:[],unresolved:[]},[citation]).includes('radius_answer_needs_concision'));
});
