import assert from 'node:assert/strict';
import test from 'node:test';
import {createAssistantMessageEventStream, type AssistantMessage} from '@earendil-works/pi-ai';
import {assertResearchPricing, meteredStream, MODEL, RESEARCH_PRICING} from '../research/model.js';
import type {ResearchStore, Lease} from '../research/store.js';
test('expired model pricing rejects work before a model request can be prepared',()=>{
 const reviewed=Date.parse(RESEARCH_PRICING.reviewedAt),expiry=Date.parse(RESEARCH_PRICING.expiresAt);
 assert.equal(expiry-reviewed,7*24*60*60*1000);
 assert.doesNotThrow(()=>assertResearchPricing(reviewed));
 assert.doesNotThrow(()=>assertResearchPricing(expiry));
 assert.throws(()=>assertResearchPricing(expiry+1),/pricing_refresh_required/);
 assert.throws(()=>assertResearchPricing(Number.NaN),/pricing_refresh_required/);
 assert.throws(()=>assertResearchPricing(Number.POSITIVE_INFINITY),/pricing_refresh_required/);
});
test('reviewed price snapshot retains conservative peak costs and source attribution',()=>{
 assert.equal(RESEARCH_PRICING.reviewedAt,'2026-10-10');
 assert.equal(MODEL.cost.input,RESEARCH_PRICING.usdPeakPerMillion.input);
 assert.equal(MODEL.cost.output,RESEARCH_PRICING.usdPeakPerMillion.output);
 assert.equal(MODEL.cost.cacheWrite,MODEL.cost.input);
 assert.ok(RESEARCH_PRICING.inputMicros>=RESEARCH_PRICING.cnyPeakPerMillion.input);
 assert.ok(RESEARCH_PRICING.outputMicros>=RESEARCH_PRICING.cnyPeakPerMillion.output);
 assert.equal(RESEARCH_PRICING.sources.length,2);
});

test('expired pricing makes no reservation and never invokes the provider',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse(RESEARCH_PRICING.expiresAt)+1);
 let reserved=0,requested=0;
 const store={assertLease:async()=>{},reserve:async()=>{reserved++;return'call';}} as unknown as ResearchStore;
 const provider={streamSimple:()=>{requested++;throw new Error('provider must not be called');}} as unknown as Parameters<typeof meteredStream>[4];
 const response=await meteredStream(store,{} as Lease,{key:'synthetic-key',configId:null},'research',provider)(MODEL,{messages:[]});
 for await(const _event of response){/* drain the isolated stream */}
 assert.equal((await response.result()).errorMessage,'pricing_refresh_required');
 assert.equal(reserved,0);assert.equal(requested,0);
});

test('valid pricing uses the same reviewed version for conservative reservation and settlement',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse(RESEARCH_PRICING.reviewedAt)+1000);
 const reservations:Array<{amount:number;metadata:unknown}>=[],settlements:Array<{cost:number;metadata:unknown}>=[];
 const store={assertLease:async()=>{},reserve:async(_lease:unknown,amount:number,_kind:unknown,metadata:unknown)=>{reservations.push({amount,metadata});return'call';},log:async()=>{},settle:async(_id:unknown,cost:number,metadata:unknown)=>{settlements.push({cost,metadata});}} as unknown as ResearchStore;
 const message={role:'assistant',content:[],api:MODEL.api,provider:MODEL.provider,model:MODEL.id,usage:{input:10,output:4,cacheRead:20,cacheWrite:5,totalTokens:39,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()} as AssistantMessage;
 const provider={streamSimple:()=>{const upstream=createAssistantMessageEventStream();upstream.push({type:'done',reason:'stop',message});upstream.end(message);return upstream;}} as unknown as Parameters<typeof meteredStream>[4];
 const context={messages:[]};
 const response=await meteredStream(store,{} as Lease,{key:'synthetic-key',configId:null},'research',provider)(MODEL,context);
 for await(const _event of response){/* no external model is used */}
 assert.equal((await response.result()).stopReason,'stop');
 assert.equal(reservations.length,1);assert.equal(settlements.length,1);
 assert.equal(reservations[0].amount,(Buffer.byteLength(JSON.stringify(context))+8192)*3+4096*12);
 assert.equal(settlements[0].cost,153);
 assert.equal((reservations[0].metadata as {priceVersion:string}).priceVersion,RESEARCH_PRICING.priceVersion);
 assert.equal((settlements[0].metadata as {priceVersion:string}).priceVersion,RESEARCH_PRICING.priceVersion);
});

test('interrupted calls retain the price version without claiming settled cost',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse(RESEARCH_PRICING.reviewedAt)+1000);
 const settlements:Array<{cost:unknown;metadata:{priceVersion?:string}}>=[];
 const store={assertLease:async()=>{},reserve:async()=> 'call',settle:async(_id:unknown,cost:unknown,metadata:{priceVersion?:string})=>{settlements.push({cost,metadata});}} as unknown as ResearchStore;
 const provider={streamSimple:()=>{throw new Error('synthetic provider interruption');}} as unknown as Parameters<typeof meteredStream>[4];
 const response=await meteredStream(store,{} as Lease,{key:'synthetic-key',configId:null},'research',provider)(MODEL,{messages:[]});
 for await(const _event of response){/* fake provider only */}
 assert.equal((await response.result()).stopReason,'error');
 assert.equal(settlements.length,1);
 assert.equal(settlements[0].cost,null);
 assert.equal(settlements[0].metadata.priceVersion,RESEARCH_PRICING.priceVersion);
});
