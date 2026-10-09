import test from 'node:test';import assert from 'node:assert/strict';
import {readableEvidenceText} from '../src/features/radius/answer-format.js';
test('known citation markers are hidden without deleting unrecognized evidence text',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal(readableEvidenceText(`可核对的结论[${id}]。`,[id]),'可核对的结论。');
 assert.equal(readableEvidenceText(`未知编号[${id}]。`,[]),`未知编号[${id}]。`);
});
