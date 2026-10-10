import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const registryPath = resolve(process.cwd(), 'docs/source-registry/high-value-rss.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const sources = Array.isArray(registry.sources) ? registry.sources : [];

if (sources.length === 0) throw new Error('高价值 RSS 注册表为空');
if (sources.length > Number(registry.maxSources || 50)) {
  throw new Error(`RSS 数量 ${sources.length} 超过上限 ${registry.maxSources || 50}`);
}

const uniqueUrls = new Set(sources.map((source) => new URL(source.feedUrl).toString()));
if (uniqueUrls.size !== sources.length) throw new Error('高价值 RSS 注册表存在重复 URL');

const checkFeed = async (source, attempt = 0) => {
  try {
    const response = await fetch(source.feedUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'user-agent': 'InfoHub-V3-Source-Audit/1.0',
      },
    });
    const body = await response.text();
    const looksLikeFeed = /<(?:rss|feed|rdf:RDF)\b/i.test(body.slice(0, 20_000));
    return {
      name: source.name,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      looksLikeFeed,
      bytes: Buffer.byteLength(body),
    };
  } catch (error) {
    if (attempt < 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
      return checkFeed(source, attempt + 1);
    }
    const { stdout } = await execFileAsync('curl', [
      '--location',
      '--max-time',
      '30',
      '--silent',
      '--show-error',
      '--fail-with-body',
      '--user-agent',
      'InfoHub-V3-Source-Audit/1.0',
      source.feedUrl,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return {
      name: source.name,
      status: 200,
      contentType: 'curl-fallback',
      looksLikeFeed: /<(?:rss|feed|rdf:RDF)\b/i.test(stdout.slice(0, 20_000)),
      bytes: Buffer.byteLength(stdout),
    };
  }
};

const results = await Promise.allSettled(sources.map(checkFeed));
let failures = 0;

results.forEach((result, index) => {
  const source = sources[index];
  if (result.status === 'rejected') {
    failures += 1;
    console.error(`FAIL ${source.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return;
  }
  const ok = result.value.status >= 200 && result.value.status < 400 && result.value.looksLikeFeed;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${result.value.name}: HTTP ${result.value.status}, ${result.value.bytes} bytes, ${result.value.contentType || 'unknown'}`);
});

console.log(`\n高价值 RSS 实时验证：${sources.length - failures}/${sources.length} 通过`);
if (failures > 0) process.exitCode = 1;
