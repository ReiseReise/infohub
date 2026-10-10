import { z } from 'zod';

const term = z.string().trim().min(1).max(100);
const terms = z.array(term).max(30).transform(xs => [...new Set(xs)]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const date = new Date(s + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
});
export const topicInput = z.object({
  name: z.string().trim().min(1).max(80),
  terms: terms.refine(xs => xs.length > 0, '至少填写一个关键词'),
  exclude: terms.default([]),
  sourceIds: z.array(z.number().int().positive()).max(200).default([]),
  archived: z.boolean().default(false),
}).strict();
export const savedTopic = topicInput.extend({
  id: z.string().uuid(), version: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type TopicInput = z.infer<typeof topicInput>;
export type Topic = z.infer<typeof savedTopic>;
export const searchInput = z.object({
  q: z.string().trim().max(300).default(''),
  topicId: z.string().uuid().optional(),
  sourceIds: z.array(z.number().int().positive()).max(200).default([]),
  from: day.optional(), to: day.optional(),
  sort: z.enum(['relevance', 'newest']).default('relevance'),
  matching: z.enum(['strict','broad']).default('strict'),
  dateBasis: z.enum(['published','received']).default('published'),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10000).default(0),
}).strict().refine(x => !x.from || !x.to || x.from <= x.to, '开始日期不能晚于结束日期')
  .refine(x => x.offset % x.limit === 0, 'offset 必须是 limit 的整数倍');
export type SearchInput = z.infer<typeof searchInput>;

export function queryTerms(q: string) {
  return [...new Set(q.match(/"[^"]+"|[^\s]+/g)?.map(s => s.replace(/^"|"$/g, '').toLowerCase()) || [])].slice(0, 20);
}
export function plainText(s: unknown): string {
  return String(s || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
export function excerpt(body: string, needles: string[], length = 420): string {
  const lower = body.toLowerCase();
  const hits = needles.map(s => lower.indexOf(s.toLowerCase())).filter(n => n >= 0);
  const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 100);
  return (start ? '…' : '') + body.slice(start, start + length) + (body.length > start + length ? '…' : '');
}
export function safeUrl(value: unknown): string | null {
  try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
