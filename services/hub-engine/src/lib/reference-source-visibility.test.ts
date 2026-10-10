import assert from 'node:assert/strict';
import test from 'node:test';
import { isReferenceSourceVisibleInMainReading } from './reference-source-visibility.js';

test('shadow and radar sources stay out of the main reading experience', () => {
  assert.equal(isReferenceSourceVisibleInMainReading({
    status: 'active',
    sourceRole: 'reference',
    config: { integrationStatus: 'shadow' },
  }), false);
  assert.equal(isReferenceSourceVisibleInMainReading({
    status: 'active',
    sourceRole: 'radar',
    config: { integrationStatus: 'active' },
  }), false);
});

test('only explicitly active normal reference sources enter main reading', () => {
  assert.equal(isReferenceSourceVisibleInMainReading({
    status: 'active',
    sourceRole: 'normal',
    config: { integrationStatus: 'active' },
  }), true);
  assert.equal(isReferenceSourceVisibleInMainReading({
    status: 'paused',
    sourceRole: 'normal',
    config: { integrationStatus: 'active' },
  }), false);
});

