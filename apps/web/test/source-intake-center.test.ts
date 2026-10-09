import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryReasonLabel } from '../src/features/sources/source-intake-model.ts';

test('source intake center keeps discovery reasons in user language', () => {
  assert.equal(discoveryReasonLabel('direct-feed'), '直接命中 feed');
  assert.equal(discoveryReasonLabel('html-alternate'), '站点 alternate feed');
  assert.equal(discoveryReasonLabel('rsshub-route'), 'RSSHub 路由');
  assert.equal(discoveryReasonLabel('existing-source-match'), '已有关联源');
  assert.equal(discoveryReasonLabel('url-probe'), '常见 feed 路径探测');
  assert.equal(discoveryReasonLabel('custom-reason'), 'custom-reason');
});
