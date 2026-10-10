import { createHash } from "node:crypto";
import { z } from "zod";

export const draftSchema = z
  .object({
    title: z.string().min(1).max(300),
    facts: z
      .array(
        z.object({
          text: z.string().min(1).max(2000),
          citations: z.array(z.string().uuid()).min(1).max(12),
        }),
      )
      .max(60),
    analysis: z
      .array(
        z.object({
          text: z.string().min(1).max(3000),
          citations: z.array(z.string().uuid()).min(1).max(12),
        }),
      )
      .max(30),
    unresolved: z.array(z.string().min(1).max(1500)).max(30),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export type Source = {
  id: string;
  title: string;
  url: string;
  body: string;
  author?: string | null;
  published_at?: string | null;
  content_hash: string;
};
export type Citation = {
  id: string;
  source_id: string;
  quote: string;
  start_offset: number;
  end_offset: number;
};
export const createRunSchema = z
  .object({
    kind: z.enum(["daily", "topic"]).default("topic"),
    question: z.string().trim().min(3).max(4000),
    sourceIds: z.array(z.string().uuid()).max(100).default([]),
    // Topic research defaults to the complete eligible collected index. An
    // explicit sourceIds list remains available for a deliberately narrow run.
    scope: z.enum(["all_collected", "selected"]).default("all_collected"),
    corpus: z.literal('radius').optional(),
    radiusRequestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    sourceId: z.number().int().positive().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(v + "T00:00:00Z");
        return (
          Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
        );
      }, "invalid_calendar_date")
      .optional(),
    network: z.boolean().default(false),
    publicSearchTerms: z
      .array(z.string().trim().min(2).max(160))
      .max(20)
      .default([]),
  })
  .strict();
export type RunInput = z.infer<typeof createRunSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function validateDraft(
  draft: Draft,
  citations: Citation[],
  sources: Source[],
): string[] {
  const errors: string[] = [];
  if (!draft.facts.length) errors.push("no_verified_facts");
  const cs = new Map(citations.map((c) => [c.id, c])),
    ss = new Map(sources.map((s) => [s.id, s]));
  for (const entry of [...draft.facts, ...draft.analysis]) {
    if (
      /https?:\/\/|\]\(|<\/?[a-z]|摘要失败|待生成|TIL \[|lorem ipsum/i.test(
        entry.text,
      )
    )
      errors.push("unsupported_link_or_placeholder");
    for (const id of entry.citations) {
      const c = cs.get(id);
      const s = c && ss.get(c.source_id);
      if (
        !c ||
        !s ||
        c.end_offset > s.body.length ||
        s.body.slice(c.start_offset, c.end_offset) !== c.quote
      )
        errors.push("invalid_evidence");
    }
  }
  return [...new Set(errors)];
}
const escapeMarkdown = (s: string) => s.replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
export function renderDraft(
  draft: Draft,
  citations: Citation[],
  sources: Source[],
): string {
  const cs = new Map(citations.map((c) => [c.id, c])),
    ss = new Map(sources.map((s) => [s.id, s]));
  const render = (entry: { text: string; citations: string[] }) =>
    `${escapeMarkdown(entry.text)} ${entry.citations
      .map((id) => {
        const c = cs.get(id),
          s = c && ss.get(c.source_id);
        return s ? `[证据](/research?evidence=${s.id}&citation=${id})` : "";
      })
      .join(" ")}`;
  return [
    `# ${escapeMarkdown(draft.title)}`,
    "## 事实",
    ...draft.facts.map((f) => `- ${render(f)}`),
    "## 分析",
    ...draft.analysis.map((f) => `- ${render(f)}`),
    ...(draft.unresolved.length
      ? ["## 待核实", ...draft.unresolved.map((s) => `- ${escapeMarkdown(s)}`)]
      : []),
  ].join("\n\n");
}
export function reserveAllowed(
  budget: number,
  spent: number,
  reserved: number,
  next: number,
) {
  return (
    [budget, spent, reserved, next].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) && spent + reserved + next <= budget
  );
}

// Accept only observed, unambiguous response envelopes; never discard unresolved findings.
export function parseRevisedDraft(value: unknown): Draft {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'draft' in value)
    return draftSchema.parse((value as {draft:unknown}).draft);
  return draftSchema.parse(value);
}
export function parseVerification(value: unknown) {
  const verdict=z.object({pass:z.boolean(),issues:z.array(z.string()).max(50),unresolved:z.array(z.string()).max(50).optional()}).strict().parse(value);
  const issues=[...verdict.issues,...(verdict.unresolved||[]).map(s=>'待核实：'+s)];
  return {pass:verdict.pass && issues.length===0,issues};
}
