import test from 'node:test';
import assert from 'node:assert/strict';
import {materialFromRow,publishedDate} from './material.js';
import {documentFromRow} from './meili.js';
const prose='这是完整段落中有具体背景、事实及限制的材料。'.repeat(20);
test('audio descriptions and short feed snippets cannot stand in for full evidence',()=>{
 assert.equal(materialFromRow({source_type:'audio',content:prose}).qa_eligible,false);
 assert.equal(materialFromRow({content:'两句话的文章简介'}).content_basis,'snippet');
 assert.equal(materialFromRow({content:prose}).material_kind,'stored_text');
 assert.equal(materialFromRow({readability_content:prose,readability_status:'ready'}).material_kind,'extracted_text');
 const transcribed=materialFromRow({source_type:'audio',content:'节目简介',transcript:prose});
 assert.equal(transcribed.material_kind,'transcript');assert.equal(transcribed.qa_eligible,true);assert.ok(transcribed.content_text.includes(prose));
});
test('unknown publication dates remain unknown rather than borrowing collection dates',()=>{
 const doc=documentFromRow({id:'a',title:'资料',content:prose,fetched_at:'2026-10-02T00:00:00Z'},[],'g');
 assert.equal(doc.published_at,null);assert.equal(doc.published_ts,null);assert.equal(doc.date_basis,'unknown');assert.ok(doc.received_ts);
 assert.equal(publishedDate('not-a-date'),null);
});
