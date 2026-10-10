import test from 'node:test';
import assert from 'node:assert/strict';

import { adminRouteTarget, isAdminRole } from '../src/lib/access-control';
import {
  isStoredTokenChange,
  shouldInvalidateSessionForRequest,
  TOKEN_KEY,
} from '../src/lib/auth-storage';

test('admin-only navigation and routes are visible only to admins', () => {
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('user'), false);
  assert.equal(adminRouteTarget('admin'), '/admin');
  assert.equal(adminRouteTarget('user'), '/feed');
  assert.equal(adminRouteTarget(null), '/feed');
});

test('only the 401 response for the current token may invalidate the session', () => {
  assert.equal(shouldInvalidateSessionForRequest('token-a', 'token-a'), true);
  assert.equal(shouldInvalidateSessionForRequest('token-a', 'token-b'), false);
  assert.equal(shouldInvalidateSessionForRequest('token-a', null), false);
  assert.equal(shouldInvalidateSessionForRequest(null, null), true);
});

test('storage synchronization reacts only to real access-token changes', () => {
  assert.equal(isStoredTokenChange({ key: TOKEN_KEY, oldValue: 'token-a', newValue: 'token-b' }), true);
  assert.equal(isStoredTokenChange({ key: TOKEN_KEY, oldValue: 'token-a', newValue: null }), true);
  assert.equal(isStoredTokenChange({ key: TOKEN_KEY, oldValue: 'same', newValue: 'same' }), false);
  assert.equal(isStoredTokenChange({ key: 'unrelated', oldValue: 'a', newValue: 'b' }), false);
});
