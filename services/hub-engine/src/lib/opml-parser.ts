import { XMLParser } from 'fast-xml-parser';

export interface OpmlFeed {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  category: string;
  type: string;
}

interface OutlineNode {
  '@_text'?: string;
  '@_title'?: string;
  '@_xmlUrl'?: string;
  '@_htmlUrl'?: string;
  '@_type'?: string;
  outline?: OutlineNode | OutlineNode[];
}

export function parseOpml(xmlContent: string): OpmlFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const parsed = parser.parse(xmlContent);
  const body = parsed?.opml?.body;
  if (!body) return [];

  const feeds: OpmlFeed[] = [];
  const outlines = Array.isArray(body.outline) ? body.outline : [body.outline];

  function walk(nodes: OutlineNode[], category: string) {
    for (const node of nodes) {
      if (!node) continue;

      if (node['@_xmlUrl']) {
        feeds.push({
          title: node['@_title'] || node['@_text'] || 'Untitled',
          xmlUrl: node['@_xmlUrl'],
          htmlUrl: node['@_htmlUrl'] || undefined,
          category: category || 'uncategorized',
          type: node['@_type'] || 'rss',
        });
      }

      if (node.outline) {
        const children = Array.isArray(node.outline) ? node.outline : [node.outline];
        const subCategory = node['@_xmlUrl'] ? category : (node['@_text'] || node['@_title'] || category);
        walk(children, subCategory);
      }
    }
  }

  walk(outlines, '');
  return feeds;
}
