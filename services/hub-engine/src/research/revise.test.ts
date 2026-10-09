import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream,type AssistantMessage} from '@earendil-works/pi-ai';
import type {StreamFn} from '@earendil-works/pi-agent-core';
import {reviseWithSubmission,verifyWithSubmission} from './revise.js';
const sourceId=randomUUID(),citationId=randomUUID();
const sources=[{id:sourceId,title:'合成原文',url:'https://example.org',body:'产品发布。',content_hash:'synthetic'}];
const citations=[{id:citationId,source_id:sourceId,quote:'产品发布。',start_offset:0,end_offset:5}];
const good={title:'合成修订',facts:[{text:'产品发布。',citations:[citationId]}],analysis:[],unresolved:[]};
function responses(values:unknown[],observe:(context:any)=>void=()=>{},name="submit_draft"):StreamFn {
 let index=0;return (_model,context)=>{
  observe(context);const stream=createAssistantMessageEventStream();
  const message={role:'assistant',content:[{type:'toolCall',id:randomUUID(),name,arguments:values[Math.min(index++,values.length-1)]}],api:'openai-completions',provider:'synthetic',model:'synthetic',stopReason:'toolUse',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}} as AssistantMessage;
  stream.push({type:'done',reason:'toolUse',message});stream.end(message);return stream;
 };
}
test('missing citation is rejected, feedback is visible and only corrected draft returns',async()=>{
 const bad={...good,facts:[{text:'产品发布。'}]};let feedback=false;const logs:any[]=[];
 const value=await reviseWithSubmission({stream:responses([bad,good],c=>{if(c.messages.some((m:any)=>m.role==='toolResult'&&m.isError))feedback=true;}),signal:new AbortController().signal,prompt:'合成测试',sources,citations,assertActive:async()=>{},log:async(type,data)=>{logs.push({type,data});}});
 assert.deepEqual(value,good);assert.equal(feedback,true);assert.equal(logs.filter(l=>l.type==='tool_finished').length,2);
});
test('fabricated references fail closed after three attempts without a candidate',async()=>{
 let calls=0;
 await assert.rejects(()=>reviseWithSubmission({stream:responses([{...good,facts:[{text:'产品发布。',citations:[randomUUID()]}]}],()=>calls++),signal:new AbortController().signal,prompt:'合成测试',sources,citations,assertActive:async()=>{},log:async()=>{}}),/revision_submission_invalid/);
 assert.equal(calls,3);
});
test('revoked execution prevents model invocation',async()=>{
 let calls=0;await assert.rejects(()=>reviseWithSubmission({stream:responses([good],()=>calls++),signal:new AbortController().signal,prompt:'合成测试',sources,citations,assertActive:async()=>{throw new Error('revoked');},log:async()=>{}}),/revoked/);assert.equal(calls,0);
});

test('verifier rejects extra fields and preserves failure findings on corrected submission',async()=>{
 let feedback=false;
 const verdict=await verifyWithSubmission({stream:responses([{pass:true,issues:[],pass_note:'额外字段'},{pass:false,issues:['主张缺少证据']}],c=>{if(c.messages.some((m:any)=>m.role==='toolResult'&&m.isError))feedback=true;},'submit_verification'),signal:new AbortController().signal,prompt:'合成核对',assertActive:async()=>{},log:async()=>{}});
 assert.equal(feedback,true);assert.deepEqual(verdict,{pass:false,issues:['主张缺少证据']});
});
