export type Topic={id:string;name:string;terms:string[];exclude:string[];sourceIds:number[];archived:boolean;version:number;updatedAt:string};
export type Source={id:number;name:string;status:string;item_count:number;last_success_at:string|null;auto_fetch_enabled:boolean;last_outcome:string|null;source_type:string;source_role:string;trust_score:number;transcript_count:number;pending_transcript_count:number;undated_count:number};
export type RadiusStatus={indexedDocuments:number;collectedDocuments:number;sourceCount:number;sync:{started_at:string;completed_at:string|null;error:string|null}|null};
export type Overview={coverage:{total:number;body_count:number;author_count:number;dated_count:number;recent_count:number;extracted_count:number;transcript_count:number;pending_transcript_count:number;short_count:number};timeline:{day:string;count:number}[];sources:Source[]};
export type Item={id:string;title:string;url:string|null;source_id:number;source_name:string;published_at:string|null;received_at:string;content_basis:string;material_label:string;material_kind:string;qa_eligible:boolean;excerpt:string;is_filtered:boolean};
export type SearchResult={items:Item[];total:number;processingTimeMs:number;matching:'strict'|'broad';matchNote:string};
export type ReaderTarget={kind:'article'|'evidence';id:string};
export const field='radius-input';
export const button='radius-button';
export const primary='radius-button radius-button-primary';
export function dateText(value:string|null|undefined){return value?new Date(value.replace(' ','T').replace(/\+00$/,'Z')).toLocaleDateString('zh-CN'):'时间未注明';}
const errors:Record<string,string>={
  radius_search_not_configured:'搜索服务还没有连接，请检查服务状态。',radius_migration_required:'信息半径需要完成数据库升级。',
  radius_service_unavailable:'暂时无法连接信息半径，请稍后重试。',topic_version_conflict:'主题已在别处修改，请刷新后再编辑。',topic_name_exists:'已有同名主题，请换一个名称。',
  radius_invalid_input:'请检查输入、关键词和日期。',radius_question_needs_subject:'请补充想了解的公司、人物或主题，也可以填写检索关键词。',
  research_not_enabled:'AI 问答服务尚未启用，全文搜索仍可使用。',deepseek_credential_missing:'问答模型尚未配置，请到模型设置中补充。',
  pricing_refresh_required:'模型价格需要重新核对，问答暂缓执行。',context_limit:'材料过长，请缩小主题或指定更具体的问题。',
  budget_exhausted:'本次问题已达到预算上限，已有结果和证据已保留。',model_call_failed:'模型调用未完成，已有证据已保留。',
};
export const errorText=(error:unknown)=>errors[error instanceof Error?error.message:String(error)]||(error instanceof Error?error.message:String(error));

export type EvidencePlan={ready:boolean;reason:string|null;keywords:string;mode:string;matched:number;selected:number;sourceCount:number;warnings:string[];groups:{label:string;from:string|null;to:string|null;matched:number;eligibleInSample:number;selected:Item[]}[]};
