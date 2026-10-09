import assert from 'node:assert/strict';
import test from 'node:test';
import {assertResearchPricing} from '../research/model.js';
test('expired model pricing rejects work before a model request can be prepared',()=>{
 assert.doesNotThrow(()=>assertResearchPricing(Date.parse('2026-10-02T00:00:00Z')));
 assert.throws(()=>assertResearchPricing(Date.parse('2026-10-07T00:00:00Z')),/pricing_refresh_required/);
});
