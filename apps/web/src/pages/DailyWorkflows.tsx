import { useEffect, useState } from 'react';
import { CheckCircle2, Layers3, Loader2, Save, SearchCheck, Settings2 } from 'lucide-react';
import {
  api,
  type DailyReportWorkflowConfig,
  type DailyReportWorkflowPayload,
  type DailyReportWorkflowPreview,
} from '../lib/api';
import { dailyAgentCopy as agentCopy } from '../features/daily/agent-copy';
import {
  DailyButtonLink as ButtonLink,
  DailyFunnelRows as FunnelRows,
  DailyPageShell as PageShell,
  DailyProductNav,
  DailyStateBlock as StateBlock,
  DailyWorkflowStepCard as WorkflowStepCard,
  dailyWorkflowSteps as workflowSteps,
} from '../features/daily/ui';

function splitListInput(value?: string[] | null) {
  return (value || []).join('，');
}

function parseListInput(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function DailyWorkflows() {
  const [payload, setPayload] = useState<DailyReportWorkflowPayload | null>(null);
  const [workflow, setWorkflow] = useState<DailyReportWorkflowConfig | null>(null);
  const [preview, setPreview] = useState<DailyReportWorkflowPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingAgent, setSavingAgent] = useState<string | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, { promptTemplate: string; isActive: boolean }>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.daily.workflow()
      .then((resp) => {
        setPayload(resp.data);
        setWorkflow(resp.data.workflow);
        setAgentDrafts(Object.fromEntries((resp.data.aiScenes || []).map((scene) => [
          scene.type,
          {
            promptTemplate: scene.promptTemplate || '',
            isActive: scene.isActive !== false,
          },
        ])));
      })
      .catch((err) => setError((err as Error).message || '工作流加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await api.daily.updateWorkflow(workflow);
      setWorkflow(resp.data.workflow);
      const nextPreview = await api.daily.previewWorkflow(resp.data.workflow);
      setPreview(nextPreview.data.preview);
    } catch (err) {
      setError((err as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateNumber = (key: 'topN' | 'minScore' | 'perSourceLimit', value: string) => {
    if (!workflow) return;
    setWorkflow({ ...workflow, [key]: Number(value) });
  };

  const updateScopeList = (key: keyof DailyReportWorkflowConfig['scope'], value: string) => {
    if (!workflow) return;
    setWorkflow({
      ...workflow,
      scope: {
        ...workflow.scope,
        [key]: parseListInput(value),
      },
    });
  };

  const saveAgentConfig = async (sceneType: string) => {
    const scene = payload?.aiScenes?.find((item) => item.type === sceneType);
    const draft = agentDrafts[sceneType];
    if (!scene?.id || !draft) return;
    setSavingAgent(sceneType);
    setError(null);
    try {
      await api.aiConfigs.update(scene.id, {
        promptTemplate: draft.promptTemplate,
        isActive: draft.isActive,
      });
      const resp = await api.daily.workflow();
      setPayload(resp.data);
      setAgentDrafts(Object.fromEntries((resp.data.aiScenes || []).map((item) => [
        item.type,
        {
          promptTemplate: item.promptTemplate || '',
          isActive: item.isActive !== false,
        },
      ])));
    } catch (err) {
      setError((err as Error).message || 'Agent 配置保存失败');
    } finally {
      setSavingAgent(null);
    }
  };

  return (
    <PageShell
      title="日报工作流配置"
      eyebrow="Workflow Composer"
      description="这里配置日报的过滤策略、评分阈值、中文化规范、Agent 编排和 Prompt 链路。它决定候选池质量。"
      actions={(
        <>
          <ButtonLink to="/daily/workbench">返回工作台</ButtonLink>
          <button
            onClick={save}
            disabled={saving || !workflow}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 保存并预览
          </button>
        </>
      )}
    >
      <DailyProductNav />
      <StateBlock loading={loading} error={error}>
        {workflow && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 space-y-5">
              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="flex items-center gap-2 text-base font-semibold text-zinc-950"><Settings2 size={18} /> 当前工作流</div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <label className="text-sm text-zinc-600">
                    工作流名称
                    <input
                      value={workflow.name || ''}
                      onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                    />
                  </label>
                  <label className="text-sm text-zinc-600">
                    版本
                    <input
                      value={workflow.version || ''}
                      onChange={(event) => setWorkflow({ ...workflow, version: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { key: 'topN' as const, label: '入报数量', hint: '最终报告最多采用多少条' },
                    { key: 'minScore' as const, label: '最低精选分', hint: '低于该分数进入复核或排除' },
                    { key: 'perSourceLimit' as const, label: '单源上限', hint: '避免单一来源刷屏' },
                  ].map((field) => (
                    <label key={field.key} className="text-sm text-zinc-600">
                      {field.label}
                      <input
                        type="number"
                        value={workflow[field.key]}
                        onChange={(event) => updateNumber(field.key, event.target.value)}
                        className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                      />
                      <span className="mt-1 block text-xs text-zinc-400">{field.hint}</span>
                    </label>
                  ))}
                  <label className="flex min-h-[86px] items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                    <span>
                      <span className="block font-medium text-zinc-900">最新兜底</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-400">候选为空时允许最近高相关内容兜底</span>
                    </span>
                    <input type="checkbox" checked={workflow.enableLatestFallback} onChange={(event) => setWorkflow({ ...workflow, enableLatestFallback: event.target.checked })} />
                  </label>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="flex min-h-[74px] items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                    <span>
                      <span className="block font-medium text-zinc-900">强制中文化</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-400">外文素材必须先转成可读中文才能入报</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={workflow.requireChinese !== false}
                      onChange={(event) => setWorkflow({ ...workflow, requireChinese: event.target.checked })}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="flex items-center gap-2 text-base font-semibold text-zinc-950"><Layers3 size={18} /> 流程编排</div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {workflowSteps.map((step, index) => (
                    <WorkflowStepCard
                      key={step.key}
                      step={step}
                      index={index}
                      enabled={Boolean(workflow.enabledModules[step.key as keyof DailyReportWorkflowConfig['enabledModules']])}
                    />
                  ))}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {Object.entries(workflow.enabledModules).map(([key, value]) => (
                    <label key={key} className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
                      <span className="font-medium text-zinc-800">{workflowSteps.find((step) => step.key === key)?.title || key}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => setWorkflow({ ...workflow, enabledModules: { ...workflow.enabledModules, [key]: event.target.checked } })}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="flex items-center gap-2 text-base font-semibold text-zinc-950"><SearchCheck size={18} /> 过滤范围</div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <label className="text-sm text-zinc-600">
                    来源等级
                    <input
                      value={splitListInput(workflow.scope.sourceTiers)}
                      onChange={(event) => updateScopeList('sourceTiers', event.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                    />
                    <span className="mt-1 block text-xs text-zinc-400">例如：S，A，B</span>
                  </label>
                  <label className="text-sm text-zinc-600">
                    分类范围
                    <input
                      value={splitListInput(workflow.scope.categories)}
                      onChange={(event) => updateScopeList('categories', event.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                    />
                  </label>
                  <label className="text-sm text-zinc-600">
                    关键词范围
                    <textarea
                      value={splitListInput(workflow.scope.keywords)}
                      onChange={(event) => updateScopeList('keywords', event.target.value)}
                      rows={4}
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-teal-300"
                    />
                  </label>
                </div>
              </section>
            </main>

            <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
              <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="text-base font-semibold text-zinc-950">Prompt / 模板链路</div>
                <div className="mt-3 space-y-2">
                  {(payload?.aiScenes || []).map((scene, index) => (
                    <div key={scene.type} id={`agent-${scene.type}`} className="rounded-xl bg-zinc-50 px-3 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-zinc-800">{index + 1}. {scene.name || agentCopy[scene.type]?.name || scene.type}</div>
                        <span className={`rounded-full px-2 py-0.5 ${scene.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>{scene.isActive ? '启用' : '停用'}</span>
                      </div>
                      <div className="mt-1 text-zinc-500">{scene.provider || '未配置'} / {scene.model || '未绑定模型'}</div>
                      <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-zinc-600">
                        <span>启用该 Agent</span>
                        <input
                          type="checkbox"
                          checked={agentDrafts[scene.type]?.isActive ?? scene.isActive !== false}
                          onChange={(event) => setAgentDrafts({
                            ...agentDrafts,
                            [scene.type]: {
                              promptTemplate: agentDrafts[scene.type]?.promptTemplate ?? scene.promptTemplate ?? '',
                              isActive: event.target.checked,
                            },
                          })}
                        />
                      </label>
                      <textarea
                        value={agentDrafts[scene.type]?.promptTemplate ?? scene.promptTemplate ?? ''}
                        onChange={(event) => setAgentDrafts({
                          ...agentDrafts,
                          [scene.type]: {
                            promptTemplate: event.target.value,
                            isActive: agentDrafts[scene.type]?.isActive ?? scene.isActive !== false,
                          },
                        })}
                        rows={scene.type === 'daily_report_final' ? 10 : 7}
                        className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] leading-5 text-zinc-800 outline-none focus:border-teal-300"
                        placeholder="这里编辑该 Agent 的 Prompt。保存后下一次日报生成会使用新配置。"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] text-zinc-400">
                          {scene.promptTemplateId || '未绑定模板 ID'} · {scene.modelConfigId || '未绑定模型配置'}
                        </div>
                        <button
                          onClick={() => void saveAgentConfig(scene.type)}
                          disabled={!scene.id || savingAgent === scene.type}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                        >
                          {savingAgent === scene.type ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          保存 Agent
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                <div className="text-base font-semibold text-zinc-950">预览漏斗</div>
                <div className="mt-3">
                  {preview
                    ? <FunnelRows funnel={preview.funnel} />
                    : <p className="text-sm leading-6 text-zinc-500">保存后会显示当前策略的候选池漏斗，便于判断是否过严、过宽或噪声过多。</p>}
                </div>
              </div>
            </aside>
          </div>
        )}
      </StateBlock>
    </PageShell>
  );
}
