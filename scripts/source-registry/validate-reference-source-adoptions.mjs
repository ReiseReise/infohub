#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(fileName) {
  return JSON.parse(await readFile(path.join(ROOT, 'docs/source-registry', fileName), 'utf8'));
}

export function validateReferenceSourceAdoptions({ catalog, decisions, adopted, rawSources }) {
  const errors = [];
  const catalogByKey = new Map((catalog.sources || []).map((source) => [source.key, source]));
  const decisionsByKey = new Map((decisions.decisions || []).map((decision) => [decision.catalogKey, decision]));
  const rawById = new Map((rawSources.sources || []).map((source) => [source.id, source]));
  const adoptedKeys = new Set();

  for (const source of adopted.sources || []) {
    if (!source.catalogKey) {
      errors.push('adopted source is missing catalogKey');
      continue;
    }
    if (adoptedKeys.has(source.catalogKey)) errors.push(`duplicate adopted catalogKey: ${source.catalogKey}`);
    adoptedKeys.add(source.catalogKey);

    if (!catalogByKey.has(source.catalogKey)) errors.push(`adopted source is absent from catalog: ${source.catalogKey}`);
    const decision = decisionsByKey.get(source.catalogKey);
    if (!decision || decision.decision !== 'active' || decision.runtimeStatus !== 'active' || decision.formalSubscription !== true) {
      errors.push(`adopted source is not formally active in decisions: ${source.catalogKey}`);
    }
    const rawSource = rawById.get(source.rawSourceId);
    if (!rawSource) {
      errors.push(`adopted source is absent from raw registry: ${source.catalogKey}`);
      continue;
    }
    if (rawSource.provenance?.referenceCatalogKey !== source.catalogKey) {
      errors.push(`raw registry provenance mismatch: ${source.catalogKey}`);
    }
  }

  for (const decision of decisions.decisions || []) {
    if (decision.formalSubscription === true && !adoptedKeys.has(decision.catalogKey)) {
      errors.push(`formal decision is absent from adopted registry: ${decision.catalogKey}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    catalogCount: catalogByKey.size,
    decisionCount: decisionsByKey.size,
    adoptedCount: adoptedKeys.size,
  };
}

export async function validateReferenceSourceAdoptionFiles() {
  const [catalog, decisions, adopted, rawSources] = await Promise.all([
    readJson('reference-source-catalog.json'),
    readJson('reference-source-decisions.json'),
    readJson('adopted-reference-sources.json'),
    readJson('raw-sources.json'),
  ]);
  return validateReferenceSourceAdoptions({ catalog, decisions, adopted, rawSources });
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  validateReferenceSourceAdoptionFiles()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
