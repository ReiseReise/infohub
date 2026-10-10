import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectFile = (relativePath: string) => new URL(`../../../../${relativePath}`, import.meta.url);

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(projectFile(relativePath), 'utf8');
}

function extractService(compose: string, service: string, nextService?: string): string {
  const start = compose.indexOf(`  ${service}:`);
  const end = nextService ? compose.indexOf(`\n  ${nextService}:`, start) : compose.length;
  assert.ok(start >= 0 && end > start, `missing ${service} service boundary`);
  return compose.slice(start, end);
}

function extractLocation(nginx: string, locationDeclaration: string): string {
  const start = nginx.indexOf(`        ${locationDeclaration} {`);
  const end = nginx.indexOf('\n        }', start);
  assert.ok(start >= 0 && end > start, `missing ${locationDeclaration} location`);
  return nginx.slice(start, end);
}

test('deployment defaults bind the unified entry to loopback and opt out of registration and AI', async () => {
  const [compose, envExample] = await Promise.all([
    readProjectFile('docker-compose.yml'),
    readProjectFile('.env.example'),
  ]);
  const hubEngine = extractService(compose, 'hub-engine', 'dibao-reader');
  const nginx = extractService(compose, 'nginx');
  const optInVariables = [
    'ALLOW_REGISTRATION',
    'AI_PROCESSING_ENABLED',
    'AI_SCORING_ENABLED',
    'AI_SUMMARY_ENABLED',
    'AI_TRANSLATION_ENABLED',
  ];

  assert.match(nginx, /\$\{INFOHUB_BIND_ADDRESS:-127\.0\.0\.1\}:80:80/);
  assert.match(envExample, /^INFOHUB_BIND_ADDRESS=127\.0\.0\.1$/m);
  for (const variable of optInVariables) {
    assert.ok(
      hubEngine.includes(`${variable}: \${${variable}:-false}`),
      `${variable} must default to false in the hub-engine environment`,
    );
    assert.match(envExample, new RegExp(`^${variable}=false$`, 'm'));
  }
});

test('Reader Lab proxy entries require the existing ops credentials', async () => {
  const nginx = await readProjectFile('nginx/nginx.conf');
  const redirect = extractLocation(nginx, 'location = /reader-lab/proxy');
  const proxy = extractLocation(nginx, 'location /reader-lab/proxy/');

  for (const location of [redirect, proxy]) {
    assert.match(location, /auth_basic "InfoHub Ops";/);
    assert.match(location, /auth_basic_user_file \/etc\/nginx\/ops\.htpasswd;/);
  }
  assert.doesNotMatch(redirect, /\breturn\b/);
  assert.match(redirect, /proxy_pass http:\/\/dibao-reader:8080\//);
});
