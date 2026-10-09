import test from 'node:test';import assert from 'node:assert/strict';
import {parseRadiusVerification} from './verification.js';
const draft={title:'回答',facts:[{text:'报道引述研究者称进行了尝试。',citations:['c']}],analysis:[{text:'选材显示这一讨论角度。',citations:['c']}],unresolved:['不能据此推断总体比例。']};
const checks=[{section:'facts',index:0,verdict:'matches_evidence',reason:'归属和尝试表述与原文一致。'},{section:'analysis',index:0,verdict:'matches_evidence',reason:'明确限于选材。'},{section:'unresolved',index:0,verdict:'stated_limit',reason:'明确承认样本局限。'}];
test('only a complete set of per-entry judgments can pass radius verification',()=>{
 assert.equal(parseRadiusVerification({checks},draft).pass,true);
 assert.throws(()=>parseRadiusVerification({checks:checks.slice(1)},draft),/verification_entry_missing/);
 assert.throws(()=>parseRadiusVerification({checks:[...checks,checks[0]]},draft),/verification_duplicate_or_unknown_entry/);
 assert.throws(()=>parseRadiusVerification({checks:[{...checks[0],verdict:'stated_limit'},...checks.slice(1)]},draft),/verification_fact_cannot_be_downgraded_to_limit/);
});
test('one unsupported claim still blocks the answer; positive observations are not errors',()=>{
 const result=parseRadiusVerification({checks:[{...checks[0],verdict:'not_supported',reason:'材料仅记载尝试，不能支持成功。'},...checks.slice(1)]},draft);
 assert.equal(result.pass,false);assert.equal(result.issues.length,1);assert.match(result.issues[0],/不能支持成功/);
});
