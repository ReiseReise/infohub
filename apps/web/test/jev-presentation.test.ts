import test from 'node:test';
import assert from 'node:assert/strict';
import {jevFoldedTargets} from '../src/lib/jev-presentation';
const pair=(a:string,b:string,status='suggested')=>({target_id:a,peer_id:b,status,suggestion:{action:'collapse_preview'}});
test('Jev fold preview never hides both sides or transitively collapses new developments',()=>{
 assert.deepEqual([...jevFoldedTargets([pair('a','b'),pair('b','a')])],['b']);
 assert.deepEqual([...jevFoldedTargets([pair('a','b'),pair('b','c')])],['b']);
 assert.deepEqual([...jevFoldedTargets([pair('a','b','stale'),pair('b','c','experiment')])],[]);
 assert.deepEqual([...jevFoldedTargets([pair('a','a')])],[]);
});
