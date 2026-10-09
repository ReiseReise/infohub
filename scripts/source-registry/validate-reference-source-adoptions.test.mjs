import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReferenceSourceAdoptions } from './validate-reference-source-adoptions.mjs';

const catalog = {
  sources: [{ key: 'qmreader:example', name: 'Example' }],
};

test('empty formal adoption registry is valid while sources are only observing', () => {
  const result = validateReferenceSourceAdoptions({
    catalog,
    decisions: {
      decisions: [{
        catalogKey: 'qmreader:example',
        decision: 'observing',
        runtimeStatus: 'shadow',
        formalSubscription: false,
      }],
    },
    adopted: { sources: [] },
    rawSources: { sources: [] },
  });

  assert.equal(result.valid, true);
  assert.equal(result.adoptedCount, 0);
});

test('formal adoption must match the decision ledger and raw registry provenance', () => {
  const valid = validateReferenceSourceAdoptions({
    catalog,
    decisions: {
      decisions: [{
        catalogKey: 'qmreader:example',
        decision: 'active',
        runtimeStatus: 'active',
        formalSubscription: true,
      }],
    },
    adopted: {
      sources: [{ catalogKey: 'qmreader:example', rawSourceId: 'reference-example' }],
    },
    rawSources: {
      sources: [{
        id: 'reference-example',
        provenance: { referenceCatalogKey: 'qmreader:example' },
      }],
    },
  });
  assert.equal(valid.valid, true);

  const invalid = validateReferenceSourceAdoptions({
    catalog,
    decisions: {
      decisions: [{
        catalogKey: 'qmreader:example',
        decision: 'active',
        runtimeStatus: 'active',
        formalSubscription: true,
      }],
    },
    adopted: { sources: [] },
    rawSources: { sources: [] },
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /formal decision is absent/);
});
