import test from 'node:test';import assert from 'node:assert/strict';
import {readableEvidenceText,radiusAnswerMarkdown} from '../src/features/radius/answer-format.js';
test('known citation markers are hidden without deleting unrecognized evidence text',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal(readableEvidenceText(`可核对的结论[${id}]。`,[id]),'可核对的结论。');
 assert.equal(readableEvidenceText(`未知编号[${id}]。`,[]),`未知编号[${id}]。`);
});

test('human and malformed structured drafts retain the latest saved Markdown',()=>{
 for(const payload of [{},null,undefined,{facts:[],analysis:null,unresolved:[]},
  {facts:[{text:'fact',citations:null}],analysis:[],unresolved:[]}]) {
  const detail={drafts:[{markdown:'# 最新人工编辑稿\n\n保留完整正文。',payload},{markdown:'旧模型稿'}],citations:[],sources:[]};
  assert.equal(radiusAnswerMarkdown(detail),'# 最新人工编辑稿\n\n保留完整正文。');
 }
 assert.equal(radiusAnswerMarkdown({drafts:[],citations:[],sources:[]}),'');
});

test('structured answers retain analysis, facts, limits and source links',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const markdown=radiusAnswerMarkdown({drafts:[{markdown:'fallback',payload:{facts:[{text:'事实',citations:[id]}],analysis:[{text:'分析',citations:[id]}],unresolved:['资料不足']}}],
  citations:[{id,source_id:'source-1'}],sources:[{id:'source-1'}]});
 assert.match(markdown,/分析 \[1\]\(#radius-evidence-source-1\)/);
 assert.match(markdown,/资料中的依据[\s\S]*事实/);
 assert.match(markdown,/仍待确认[\s\S]*资料不足/);
});
