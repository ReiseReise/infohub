import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '../..');
const registryPath = resolve(projectRoot, 'docs/source-registry/high-value-rss.json');
const opmlPath = resolve(projectRoot, 'docs/source-registry/high-value-rss.opml');

const escapeXml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
if (!Array.isArray(registry.sources) || registry.sources.length === 0) {
  throw new Error('高价值 RSS 注册表为空');
}
if (registry.sources.length > Number(registry.maxSources || 50)) {
  throw new Error(`高价值 RSS 数量 ${registry.sources.length} 超过上限 ${registry.maxSources || 50}`);
}

const seen = new Set();
for (const source of registry.sources) {
  if (!source.name || !source.feedUrl) throw new Error('每个信源必须包含 name 和 feedUrl');
  const normalized = new URL(source.feedUrl).toString();
  if (seen.has(normalized)) throw new Error(`重复 RSS：${source.feedUrl}`);
  seen.add(normalized);
}

const groups = new Map();
for (const source of registry.sources) {
  const group = source.collection === 'news_radar' ? '新闻雷达' : '核心精读';
  const entries = groups.get(group) || [];
  entries.push(source);
  groups.set(group, entries);
}

const outlines = [...groups.entries()].map(([group, sources]) => {
  const children = sources.map((source) => {
    const dailyReportAttribute = source.dailyReportEnabled === true ? ' dailyReportEnabled="true"' : '';
    return `      <outline type="rss" text="${escapeXml(source.name)}" title="${escapeXml(source.name)}" xmlUrl="${escapeXml(source.feedUrl)}" htmlUrl="${escapeXml(source.siteUrl)}" category="${escapeXml(source.category)}"${dailyReportAttribute} />`;
  }).join('\n');
  return `    <outline text="${group}" title="${group}">\n${children}\n    </outline>`;
}).join('\n');

const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>信息中枢 V3 高价值 RSS 冷启动集</title>
    <dateModified>${new Date().toISOString()}</dateModified>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;

await writeFile(opmlPath, opml, 'utf8');
console.log(`已生成 ${registry.sources.length} 个 RSS：${opmlPath}`);
