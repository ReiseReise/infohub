import { sql, type SQL } from 'drizzle-orm';
import { schema } from '../db/index.js';

export type ReferenceSourceVisibilityInput = {
  status?: string | null;
  sourceRole?: string | null;
  config?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function isReferenceSourceVisibleInMainReading(input: ReferenceSourceVisibilityInput): boolean {
  if (String(input.status || 'active').trim().toLowerCase() !== 'active') return false;
  const role = String(input.sourceRole || 'normal').trim().toLowerCase();
  if (role === 'radar' || role === 'reference') return false;
  const integrationStatus = String(asRecord(input.config).integrationStatus || 'active').trim().toLowerCase();
  return !['shadow', 'paused', 'removed'].includes(integrationStatus);
}

export function mainReadingSourceCondition(): SQL<unknown> {
  return sql`(
    coalesce(${schema.sources.sourceRole}, 'normal') not in ('radar', 'reference')
    and coalesce(${schema.sources.config}->>'integrationStatus', 'active') not in ('shadow', 'paused', 'removed')
  )`;
}

