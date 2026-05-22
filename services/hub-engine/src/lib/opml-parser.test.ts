import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml } from './opml-parser.js';

test('parseOpml extracts feeds from a flat OPML document', () => {
  const feeds = parseOpml(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Example Feed" title="Example Title" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com" />
  </body>
</opml>`);

  assert.deepEqual(feeds, [
    {
      title: 'Example Title',
      xmlUrl: 'https://example.com/feed.xml',
      htmlUrl: 'https://example.com',
      category: 'uncategorized',
      type: 'rss',
    },
  ]);
});

test('parseOpml preserves nested category names for child feeds', () => {
  const feeds = parseOpml(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="AI">
      <outline text="Research" type="rss" xmlUrl="https://example.com/research.xml" />
    </outline>
  </body>
</opml>`);

  assert.deepEqual(feeds, [
    {
      title: 'Research',
      xmlUrl: 'https://example.com/research.xml',
      htmlUrl: undefined,
      category: 'AI',
      type: 'rss',
    },
  ]);
});

test('parseOpml returns an empty list when the OPML body is missing', () => {
  assert.deepEqual(parseOpml('<opml version="2.0"><head /></opml>'), []);
});

test('parseOpml rejects DTD/entity expansion input without throwing', () => {
  const feeds = parseOpml(`<?xml version="1.0"?>
<!DOCTYPE opml [
  <!ENTITY noisy "expanded">
]>
<opml version="2.0">
  <body>
    <outline text="&noisy;" type="rss" xmlUrl="https://example.com/feed.xml" />
  </body>
</opml>`);

  assert.deepEqual(feeds, []);
});
