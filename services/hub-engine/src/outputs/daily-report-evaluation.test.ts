import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFrozenLegacySnapshot,type DailyReportSnapshot} from './daily-report.js';

test('frozen legacy evaluation uses actual stages and isolates concurrent model callbacks',async()=>{
 const snapshot:DailyReportSnapshot={date:'2026-09-06',totalItems:1,newItems:1,compareWindowDays:1,topItems:[{id:'00000000-0000-4000-8000-000000000001',title:'测试公开事件',url:'https://example.org/event',sourceName:'测试来源',category:'AI',aiScore:80,aiSummary:null,editorialContext:'测试正文：公司发布产品。'}],highScoreItems:[],byCategory:[],topSources:[],themeClusters:[],generatedAt:'2026-09-06T00:00:00Z'};
 const calls=[0,0];
 const results=await Promise.all([0,1].map(i=>evaluateFrozenLegacySnapshot(snapshot,async config=>{
  assert.equal(config.model,'deepseek-flash');calls[i]++;await new Promise(r=>setTimeout(r,1));throw new Error('isolated_failure_'+i);
 })));
 for(let i=0;i<2;i++){
  assert.equal(calls[i],5);
  assert.equal(results[i].cleaning.meta.status,'fallback');
  assert.match(results[i].final.meta.error||'',new RegExp('isolated_failure_'+i));
  assert.equal(Object.keys(results[i].modules).length,3);
 }
});
