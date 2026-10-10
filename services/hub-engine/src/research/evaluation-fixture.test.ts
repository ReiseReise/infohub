import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupFrozenMaterials} from './evaluation-fixture.js';
test('splits later-window evidence without renaming unrelated frozen events',()=>{
 const materials=[{id:'a',eventKey:'shared',body:'early'},{id:'b',eventKey:'shared',body:'later'},{id:'c',eventKey:'other',body:'independent'}];
 const windows=[{date:'2026-09-10',snapshot:{topItems:[{id:'a'},{id:'c'}]}},{date:'2026-09-13',snapshot:{topItems:[{id:'b'}]}}];
 const {groups}=groupFrozenMaterials(materials,windows);
 assert.deepEqual([...groups.keys()],['shared@2026-09-10','shared@2026-09-13','other']);
 assert.deepEqual(groups.get('shared@2026-09-10')?.map(m=>m.body),['early']);
 assert.throws(()=>groupFrozenMaterials(materials,[...windows,windows[0]]),/ambiguous_material_window/);
 assert.throws(()=>groupFrozenMaterials([...materials,materials[0]],windows),/duplicate_material/);
});
