import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml } from './opml-parser.js';

test('parseOpml preserves the dedicated daily report marker', () => {
  const feeds = parseOpml(`<?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <body>
        <outline text="新闻雷达">
          <outline type="rss" text="Reuters Technology AI" xmlUrl="https://example.com/reuters.xml" dailyReportEnabled="true" />
          <outline type="rss" text="Normal Feed" xmlUrl="https://example.com/normal.xml" />
        </outline>
      </body>
    </opml>`);

  assert.equal(feeds.length, 2);
  assert.equal(feeds[0]?.dailyReportEnabled, true);
  assert.equal(feeds[1]?.dailyReportEnabled, false);
});
