import {plainText, safeUrl} from './contracts.js';

// A non-empty RSS field is not evidence of a complete article or audio transcript.
export function materialFromRow(row: Record<string, unknown>) {
  const readable=plainText(row.readability_content),content=plainText(row.content),transcript=plainText(row.transcript);
  const audio=row.source_type==='audio'||row.media_type==='audio'||row.media_type==='video';
  const text=readable||content||transcript||plainText(row.snippet);
  const combined=text+(transcript&&!text.includes(transcript)?'\n\n'+transcript:'');
  const kind=transcript?'transcript':audio?'audio_description':readable.length>=180&&row.readability_status==='ready'?'extracted_text':text.length>=180?'stored_text':text?'short_text':'missing';
  const labels={transcript:'已有转写',audio_description:'音视频简介 · 待转写',extracted_text:'正文已提取',stored_text:'已存文本 · 完整性待核实',short_text:'短内容 · 仅作线索',missing:'正文缺失'};
  const eligible=kind==='transcript'?transcript.length>=80:kind==='extracted_text'||kind==='stored_text';
  return {content_text:combined,material_kind:kind,material_label:labels[kind],qa_eligible:eligible,
    content_basis:eligible?'body':'snippet',text_chars:combined.length};
}
export function publishedDate(value: unknown): string|null {
  if(!value)return null;
  const date=value instanceof Date?value:new Date(String(value));
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
export function canonicalKey(value: unknown) {
  const safe=safeUrl(value);if(!safe)return '';
  const url=new URL(safe);url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
  url.searchParams.sort();return url.toString().replace(/\/$/,'');
}
