// Remove redundant machine citation markers only when the evidence ID is known.
// The structured citation links remain visible and the stored draft stays unchanged.
export function readableEvidenceText(text:string,citationIds:string[]){
 const known=new Set(citationIds);
 return text.replace(/\[([0-9a-f-]{36})\]/gi,(marker,id:string)=>known.has(id)?'':marker).replace(/ {2,}/g,' ').trim();
}

type AnswerEntry = { text: string; citations: string[] };
type AnswerPayload = { facts: AnswerEntry[]; analysis: AnswerEntry[]; unresolved: string[] };
type AnswerDetail = {
  drafts: Array<{ markdown: string; payload?: unknown }>;
  citations: Array<{ id: string; source_id: string }>;
  sources: Array<{ id: string }>;
};

function isEntry(value: unknown): value is AnswerEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AnswerEntry>;
  return typeof entry.text === 'string' && Array.isArray(entry.citations)
    && entry.citations.every((id) => typeof id === 'string');
}

function isPayload(value: unknown): value is AnswerPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AnswerPayload>;
  return Array.isArray(payload.facts) && payload.facts.every(isEntry)
    && Array.isArray(payload.analysis) && payload.analysis.every(isEntry)
    && Array.isArray(payload.unresolved) && payload.unresolved.every((text) => typeof text === 'string');
}

export function radiusAnswerMarkdown(detail: AnswerDetail): string {
  const draft = detail.drafts[0];
  // Human-edited drafts contain Markdown and an empty structured payload.
  if (!isPayload(draft?.payload)) return draft?.markdown || '';
  const payload = draft.payload;
  const escape = (text: string) => text.replace(/[\\`*_{}[\]<>#]/g, '\\$&');
  const map = new Map(detail.citations.map((citation) => [citation.id, citation.source_id]));
  const line = (entry: AnswerEntry) => `${escape(readableEvidenceText(entry.text, detail.citations.map((citation) => citation.id)))} ${[...new Set(entry.citations.map((id) => map.get(id)).filter(Boolean))].map((id) => `[${detail.sources.findIndex((source) => source.id === id) + 1}](#radius-evidence-${id})`).join(' ')}`;
  return [
    ...payload.analysis.map(line),
    '### 资料中的依据',
    ...payload.facts.map((fact) => '- ' + line(fact)),
    ...(payload.unresolved.length ? ['### 仍待确认', ...payload.unresolved.map((text) => '- ' + escape(text))] : []),
  ].join('\n\n');
}
