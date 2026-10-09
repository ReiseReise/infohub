import { JevPanel } from '../components/JevPanel';
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { request } from "../lib/api/shared";

type Run = {
  id: string;
  kind: string;
  question: string;
  state: string;
  reason?: string;
  spent_micros: number | string;
  reserved_micros: number | string;
  budget_micros: number | string;
};
type Material = { id: string; title: string; source_name: string };
type Evidence = {
  id: string;
  title: string;
  url: string;
  body?: string;
  author?: string;
  published_at?: string;
};
type Config = {model:string;modelReady:boolean;modelError?:string;networkReady:boolean;budgetCny:number;concurrency:number;maxRevisions:number;priceReviewDate:string;modelSettingsUrl:string};
type RunLog = {seq:number;type:string;data?:{tool?:string;error?:string;state?:string;details?:{tool?:string}}};
type Version = {
  step_id?: string;
  id: string;
  version: number;
  origin: string;
  quality: string;
  markdown: string;
};
type Detail = {
  run: Run;
  steps: Array<{ id: string; stage: string; state: string; error?: string; label?:string }>;
  drafts: Version[];
  sources: Evidence[];
  guidance: Array<{ id: string; content: string }>;
};
const labels: Record<string, string> = {
  queued: "排队中",
  running: "研究中",
  paused: "已暂停",
  cancelled: "已取消",
  review: "待核实",
  completed: "研究结束",
  failed: "失败",
  pending: "等待执行",
  done: "完成",
  research: "研究",
  verify: "事实核对",
  edit: "整报编辑",
  final_verify: "最终核对",
};
const errors: Record<string, string> = {
  user_cancelled: "已按你的要求取消，已有成果和证据继续保留。",
  research_not_enabled: "新版研究尚未启用。现有日报仍可正常阅读。",
  deepseek_credential_missing: "尚未配置 DeepSeek 凭据，任务和资料已保留。",
  model_encryption_key_missing: "模型凭据暂时无法读取，请检查配置。",
  brave_credential_missing: "尚未配置联网搜索凭据。",
  budget_exhausted: "本份成果预算已用尽，部分成果已保留。",
  draft_version_conflict: "已有新版本，请重新打开最新稿件后再保存。",
  pricing_refresh_required: "价格配置需要核对后才能继续。",
  unfinished_events_require_resume: "其他事件尚未结束，请使用恢复继续原任务；局部重跑不会代替你恢复整报。",
  no_evidence: "没有找到可用证据，请换个主题或补充资料。",
};
const message = (e: unknown) =>
  errors[e instanceof Error ? e.message : String(e)] ||
  (e instanceof Error ? e.message : "操作失败，请重试");
const money = (n: number | string) => "¥" + (Number(n) / 1000000).toFixed(3);
const field =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm";
const button =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40";
export function Research() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const [settings,setSettings]=useState<Config|null>(null);
  const [runs, setRuns] = useState<Run[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [materials, setMaterials] = useState<Material[]>([]);
  const [kind, setKind] = useState<"topic" | "daily">("topic");
  const [date, setDate] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
  );
  const [question, setQuestion] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [network, setNetwork] = useState(false),
    [terms, setTerms] = useState("");
  const [notice,setNotice]=useState("");
  const [loadError,setLoadError]=useState("");
  const [materialError,setMaterialError]=useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [guidance, setGuidance] = useState(""),
    [editor, setEditor] = useState(""),
    [baseVersion, setBaseVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [evidence, setEvidence] = useState<Evidence | null>(null);
  const [log, setLog] = useState<RunLog[]>([]);
  const logCursor=useRef(0);
  const generation = useRef(0),
    pendingCreate = useRef<{ key: string; input: string } | null>(null);
  useEffect(()=>{let active=true;void request<{data:Config}>('/research/config').then(r=>{if(active)setSettings(r.data);}).catch(e=>{if(active)setLoadError(message(e));});return()=>{active=false;};},[]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const r = await request<{ data: Run[] }>("/research/runs");
      if (current !== generation.current) return;
      setRuns(r.data);
      setLoadError("");
      if (runId) {
        const d = await request<{ data: Detail }>(`/research/runs/${runId}`);
        if (current !== generation.current) return;
        setDetail(d.data);
        const e = await request<{ data: RunLog[] }>(
          `/research/runs/${runId}/events?after=${logCursor.current}`,
        );
        if (current === generation.current && e.data.length) {logCursor.current=Number(e.data[e.data.length-1].seq);setLog(old=>[...old,...e.data.filter(x=>!old.some(y=>y.seq===x.seq))].slice(-500));}
      }
    } catch (e) {
      if (current === generation.current) setLoadError(message(e));
    }
  }, [runId]);
  useEffect(() => {
    const generationRef = generation;
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      clearInterval(interval);
      generationRef.current++;
    };
  }, [refresh]);
  useEffect(() => {
    let active=true,busy=false;
    const load=async()=>{if(busy)return;busy=true;try{const r=await request<{data:Material[]}>("/research/materials?q="+encodeURIComponent(query));if(active){setMaterials(r.data);setMaterialError("");}}catch(e){if(active)setMaterialError(message(e));}finally{busy=false;}};
    void load();const interval=setInterval(()=>void load(),10000);
    return()=>{active=false;clearInterval(interval);};
  },[query]);
  const evidenceId = params.get("evidence");
  useEffect(() => {
    let active = true;
    if (evidenceId)
      request<{ data: Evidence }>("/research/evidence/" + evidenceId)
        .then((r) => {
          if (active) setEvidence(r.data);
        })
        .catch((e) => {
          if (active) setError(message(e));
        });
    return () => {
      active = false;
    };
  }, [evidenceId]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function rerunStage(stage: string, stepId?: string) {
    await act(async () => {
      const result = await request<{message?: string}>(`/daily/agents/daily_report_${stage}/rerun`, {
        method: 'POST', body: {engine:'trusted',runId,...(stepId?{stepId}:{})},
      });
      setNotice(result.message || '已提交指定阶段。');
    });
  }
  function openRun(id: string) {
    if (dirty) {
      setError("请先保存当前编辑，再打开其他任务。");
      return;
    }
    setNotice("");
    setDetail(null);
    setLog([]);
    logCursor.current=0;
    setEditor("");
    setBaseVersion(0);
    setParams({ run: id });
  }
  async function create() {
    await act(async () => {
      const input = {
        kind,
        question:
          kind === "daily" ? `${date} 每日精选：事实、证据与分析` : question,
        ...(kind === "daily" ? { date } : {}),
        sourceIds: selected,
        scope: kind === "topic" && selected.length === 0 ? "all_collected" : "selected",
        network,
        publicSearchTerms: network
          ? terms
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      };
      const serialized = JSON.stringify(input);
      if (pendingCreate.current?.input !== serialized)
        pendingCreate.current = { key: crypto.randomUUID(), input: serialized };
      const r = await request<{ data: Run }>("/research/runs", {
        method: "POST",
        headers: { "Idempotency-Key": pendingCreate.current.key },
        body: input,
      });
      pendingCreate.current = null;
      openRun(r.data.id);
    });
  }
  const latest =
    detail?.drafts.find((d) => d.origin === "human") || (detail?.run.kind === "daily" ? detail.drafts.find(d=>detail.steps.some(s=>s.id===d.step_id&&["edit","final_verify"].includes(s.stage))) : detail?.drafts[0]);
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <JevPanel scene="daily" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest text-zinc-500">
            信息中枢 · 研究
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            从问题到有据可查的结论
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            给出主题，Pi 会先在全部已收录资料中检索，再阅读和核对相关原文。事实、分析与待核实项分别呈现，每份成果最多 ¥10。
          </p>
        </div>
        <Link to="/daily/reports/latest" className={button}>
          阅读日报
        </Link>
      </header>
      <details className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium">Pi 怎么工作 · 模型与联网配置</summary>
        <div className="mt-3 space-y-2 text-zinc-600">
          <p>主题 → 全部已收录资料索引 → Pi 检索、阅读与查证 → 提交事实、分析和引用 → 独立核对 → 必要时修订 → 保存稿件。</p>
          <p>程序管理队列、预算、校验与保存；Pi 只能使用授权的资料工具，不能执行命令或任意读写文件。研究结束不等于内容验收通过。</p>
          <p>模型：{settings?.model || '读取中'} · {settings?.modelReady?'已配置':'尚未就绪'}。<Link className="underline" to="/admin?tab=models&center=models">打开模型配置</Link>：提供商 DeepSeek，模型 deepseek-flash，地址 https://api.deepseek.com，密钥在该页面保存。</p>
          <p>每份成果上限 ¥10，重试和恢复共用预算。联网：{settings?.networkReady?'可选启用':'尚未配置，先用已收录材料'}。联网开关和允许外发的公开搜索词在下方逐次选择。</p>
          <p>查看右侧阶段、证据与执行记录可了解处理过程；不展示模型内部思考。失败可保留稿件，补充指导后恢复。</p>
          <p className="text-xs">联网接入由部署配置 BRAVE_SEARCH_API_KEY 与 BRAVE_SEARCH_COST_MICROS 管理，不在对话中粘贴密钥。价格保护需在 {settings?.priceReviewDate || '2026-09-21'} 前复核。</p>
        </div>
      </details>
      {(error||loadError||materialError) && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {error||loadError||materialError}
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="text-lg font-semibold">新建研究</h2>
            <label className="block space-y-2 text-sm">
              成果类型
              <select
                className={field}
                value={kind}
                onChange={(e) => {
                  const v = e.target.value as "topic" | "daily";
                  setKind(v);
                  setSelected([]);
                  setNetwork(v === "daily" && Boolean(settings?.networkReady));
                }}
              >
                <option value="topic">专题研究</option>
                <option value="daily">每日精选</option>
              </select>
            </label>
            {kind === "daily" && (
              <label className="block space-y-2 text-sm">
                日报日期
                <input
                  type="date"
                  className={field}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <span className="block text-xs text-zinc-500">
                  未手选材料时，沿用当前日报工作流筛选当日资料，目标8—12个事件。
                </span>
              </label>
            )}
            {kind==="topic"&&(<label className="block space-y-2 text-sm">
              研究问题
              <textarea
                className={field}
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：近期 Agent 产品有哪些值得实际采用的变化？"
              />
            </label>)}
            {kind === "topic" ? (
              <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-zinc-700">
                  高级：限制材料范围（可选）
                </summary>
                <p className="mt-2 text-xs text-zinc-500">
                  默认使用全部已收录资料。只有你明确要缩小范围时，才在这里搜索并勾选材料。
                </p>
                <label className="mt-3 block space-y-2 text-sm">
                  搜索已收录材料
                  <input
                    className={field}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="标题关键词"
                  />
                </label>
                <p className="mt-2 text-xs text-zinc-500">已选 {selected.length} 篇；勾选后将只研究这些材料。</p>
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {materials.map((m) => (
                    <label key={m.id} className="flex items-start gap-2 rounded p-1 text-sm">
                      <input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, m.id] : s.filter((id) => id !== m.id))} />
                      <span className="min-w-0 break-words">{m.title}<small className="block text-zinc-500">{m.source_name}</small></span>
                    </label>
                  ))}
                </div>
              </details>
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  搜索已收录材料
                  <input className={field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="标题关键词（可选）" />
                </label>
                <p className="text-xs text-zinc-500">日报按日期和现有选材规则自动筛选，通常不需要手选。</p>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!settings?.networkReady}
                checked={network}
                onChange={(e) => setNetwork(e.target.checked)}
              />
              允许公开网页补证据{settings && !settings.networkReady ? "（尚未配置）" : ""}
            </label>
            {network && (
              <label className="block space-y-2 text-sm">
                允许外发的搜索词
                <textarea
                  className={field}
                  rows={2}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="每行一个公开产品或主题，不填私人信息"
                />
              </label>
            )}
            <button
              className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm text-white disabled:opacity-40"
              disabled={
                busy ||
                (kind === "topic" && question.trim().length < 3)
              }
              onClick={() => void create()}
            >
              {busy ? "正在提交…" : "开始研究"}
            </button>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold">研究记录</h2>
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => openRun(r.id)}
                className={
                  "block w-full rounded-lg border p-3 text-left " +
                  (runId === r.id
                    ? "border-zinc-900 bg-zinc-50"
                    : "border-zinc-200 bg-white")
                }
              >
                <span className="block break-words text-sm">{r.question}</span>
                <small className="text-zinc-500">
                  {labels[r.state] || r.state} · {money(r.spent_micros)}
                </small>
              </button>
            ))}
          </section>
        </aside>
        <section className="min-w-0 space-y-5">
          {detail ? (
            <>
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
                <h2 className="break-words text-xl font-semibold">
                  {detail.run.question}
                </h2>
                <p className="text-sm">
                  {labels[detail.run.state] || detail.run.state} · 费用估算{" "}
                  {money(detail.run.spent_micros)} /{" "}
                  {money(detail.run.budget_micros)} · 预留/待核账{" "}
                  {money(detail.run.reserved_micros)}
                </p>
                {detail.run.reason && (
                  <p className="text-sm text-amber-700">
                    {errors[detail.run.reason] || detail.run.reason}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={
                      busy || !["queued", "running"].includes(detail.run.state)
                    }
                    onClick={() =>
                      void act(() =>
                        request(`/research/runs/${runId}/cancel`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    取消研究
                  </button>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      ["queued", "running", "completed"].includes(
                        detail.run.state,
                      )
                    }
                    onClick={() =>
                      void act(() =>
                        request(`/research/runs/${runId}/resume`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    从已保存成果恢复
                  </button>
                </div>
                {detail.run.kind === 'daily' && <div className="flex flex-wrap gap-2">
                  <button className={button} disabled={busy || ['queued','running'].includes(detail.run.state)} onClick={()=>void rerunStage('cleaning')}>复核本次选材</button>
                  <button className={button} disabled={busy || ['queued','running'].includes(detail.run.state) || !detail.steps.some(s=>s.stage==='verify'&&s.state==='done')} onClick={()=>void rerunStage('final')}>仅重跑整报编辑</button>
                </div>}
                {notice && <p role="status" className="text-sm text-zinc-600">{notice}</p>}
                <ul className="space-y-1 text-sm">
                  {detail.steps.map((s) => (
                    <li key={s.id}>
                      {s.label&&<span className="block font-medium">{s.label}</span>}{labels[s.stage]} · {labels[s.state] || s.state}
                      {s.error ? " · " + (errors[s.error] || s.error) : ""}
                      {detail.run.kind === 'daily' && s.stage === 'research' && <button className={button + ' ml-2'} disabled={busy || ['queued','running'].includes(detail.run.state)} onClick={()=>void rerunStage('research',s.id)}>重跑此事件</button>}
                    </li>
                  ))}
                </ul>
                <label className="block space-y-2 text-sm">
                  追加指导
                  <textarea
                    className={field}
                    value={guidance}
                    onChange={(e) => setGuidance(e.target.value)}
                    rows={2}
                  />
                </label>
                <button
                  className={button}
                  disabled={busy || !guidance.trim()}
                  onClick={() =>
                    void act(async () => {
                      await request(`/research/runs/${runId}/guidance`, {
                        method: "POST",
                        headers: { "Idempotency-Key": crypto.randomUUID() },
                        body: { content: guidance },
                      });
                      setGuidance("");
                    })
                  }
                >
                  保存指导
                </button>
                <p className="text-xs text-zinc-500">
                  运行中将在下一轮读取指导；已完成任务会追加研究，沿用剩余预算并保留旧稿。
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <h2 className="mb-3 font-semibold">稿件与版本</h2>
                {latest ? (
                  <>
                    <p className="mb-3 text-xs text-zinc-500">
                      版本 {latest.version} ·{" "}
                      {latest.origin === "human"
                        ? "人工编辑"
                        : latest.quality === "verified"
                          ? "已通过程序与模型核对"
                          : "候选稿，待核实"}
                    </p>
                    <div className="prose max-w-none break-words">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                      >
                        {latest.markdown}
                      </ReactMarkdown>
                    </div>
                    <button
                      className={button + " mt-4"}
                      disabled={dirty}
                      onClick={() => {
                        setEditor(latest.markdown);
                        setBaseVersion(detail.drafts[0].version);
                        setDirty(true);
                      }}
                    >
                      编辑这一版
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">
                    {detail.run.kind === "daily" ? "整报尚未生成。单事件成果保留在下方历史版本中，不会冒充整份日报。" : "尚无稿件。即使研究中断，已提交的候选稿也会保留在这里。"}
                  </p>
                )}
                {dirty && (
                  <div className="mt-4 space-y-3">
                    <label className="block text-sm">
                      编辑稿件
                      <textarea
                        className={field + " mt-2 font-mono"}
                        rows={15}
                        value={editor}
                        onChange={(e) => setEditor(e.target.value)}
                      />
                    </label>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request(`/research/runs/${runId}/drafts`, {
                            method: "POST",
                            body: { markdown: editor, baseVersion },
                          });
                          setDirty(false);
                        })
                      }
                    >
                      另存为新版本
                    </button>
                  </div>
                )}
                <details className="mt-4 text-sm">
                  <summary>历史版本（{detail.drafts.length}）</summary>
                  {detail.drafts
                    .filter((d) => d.id !== latest?.id)
                    .map((d) => (
                      <details key={d.id} className="mt-3">
                        <summary>
                          版本 {d.version} ·{" "}
                          {d.origin === "human" ? "人工编辑" : "模型稿"}
                        </summary>
                        <div className="prose max-w-none break-words">
                          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                            {d.markdown}
                          </ReactMarkdown>
                        </div>
                      </details>
                    ))}
                </details>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <h2 className="mb-3 font-semibold">
                  证据材料（{detail.sources.length}）
                </h2>
                {detail.sources.map((s) => (
                  <button
                    key={s.id}
                    className="mb-2 block w-full break-words text-left text-sm underline"
                    onClick={() =>
                      void act(async () => {
                        const r = await request<{ data: Evidence }>(
                          "/research/evidence/" + s.id,
                        );
                        setEvidence(r.data);
                      })
                    }
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              <details className="rounded-xl border border-zinc-200 p-4 text-sm">
                <summary>执行记录（最近{log.length}条）</summary>
                {log.map((l) => (
                  <p key={l.seq}>
                    {l.seq} · {({created:'任务建立',selection_frozen:'选材已冻结',selection_rechecked:'选材已复核',step_started:'阶段开始',step_finished:'阶段结束',tool_started:'使用工具',tool_finished:'工具返回',model_response:'模型返回已保存',run_finished:'研究结束',cancelled:'已取消',resumed:'已恢复',paused:'已暂停',stage_rerun:'局部重跑'} as Record<string,string>)[l.type] || l.type}
                    {(l.data?.tool || l.data?.details?.tool) && ' · '+ (({read_source:'阅读原文',search_collected:'搜索收录资料',related_events:'查关联事件',submit_draft:'提交稿件',submit_verification:'提交核对结果',search_web:'公开搜索',read_web:'读取网页'} as Record<string,string>)[l.data?.tool || l.data?.details?.tool || ''] || l.data?.tool || l.data?.details?.tool)}
                    {l.data?.error && ' · '+(errors[l.data.error] || l.data.error)}
                  </p>
                ))}
              </details>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-zinc-500">
              从左侧提出问题，或打开一份已有研究。
            </div>
          )}
          {evidence && (
            <section className="rounded-xl border border-zinc-300 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="break-words font-semibold">{evidence.title}</h2>
                <button className={button} onClick={() => setEvidence(null)}>
                  收起
                </button>
              </div>
              <p className="my-2 text-xs text-zinc-500">
                {evidence.author || "署名未提供"} ·{" "}
                {evidence.published_at || "发布时间未提供"}
              </p>
              {/^https?:\/\//.test(evidence.url) && (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  打开原始链接
                </a>
              )}
              <pre className="mt-4 max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-7">
                {evidence.body}
              </pre>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
