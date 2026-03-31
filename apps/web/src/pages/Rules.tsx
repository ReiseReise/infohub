import { useCallback, useEffect, useState } from 'react';
import { Plus, Shield, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/use-auth';

const RULE_TYPES = [
  { value: 'ai_score_filter', label: 'AI 评分门槛' },
  { value: 'keyword_whitelist', label: '关键词白名单（加分）' },
  { value: 'keyword_blacklist', label: '关键词黑名单（过滤）' },
  { value: 'length_filter', label: '长度过滤' },
  { value: 'language_filter', label: '语言过滤' },
  { value: 'author_filter', label: '作者过滤' },
];

type RuleScope = 'user' | 'global';

interface RuleConfig {
  keywords?: string[];
  boost?: number;
  minLength?: number;
  maxLength?: number;
  languages?: string[];
  authors?: string[];
  minAiScore?: number;
  maxAiScore?: number;
  [key: string]: unknown;
}

interface Rule {
  id: number;
  userId?: string | null;
  name: string;
  type: string;
  scope?: RuleScope;
  config: RuleConfig;
  enabled: boolean;
  priority: number;
}

interface RuleFormState {
  name: string;
  type: string;
  keywords: string;
  boost: number;
  minAiScore: number;
  maxAiScore: number;
  enabled: boolean;
  priority: number;
  scope: RuleScope;
}

const DEFAULT_FORM: RuleFormState = {
  name: '',
  type: 'keyword_blacklist',
  keywords: '',
  boost: 10,
  minAiScore: 60,
  maxAiScore: 100,
  enabled: true,
  priority: 0,
  scope: 'user',
};

const NON_AI_NOISE_PRESET = '体育,足球,篮球,娱乐,明星,影视,汽车,房产,旅游,时尚,美食,情感,母婴,游戏,八卦';

export function Rules() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [scope, setScope] = useState<RuleScope>('user');
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(DEFAULT_FORM);

  const fetchRules = useCallback(async (nextScope = scope) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.rules.list({ scope: nextScope });
      setRules((res.data || []) as unknown as Rule[]);
    } catch (err) {
      setRules([]);
      setError((err as Error).message || '规则加载失败');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const buildConfig = (): RuleConfig => {
    const config: RuleConfig = {};
    if (form.type.includes('keyword')) {
      config.keywords = form.keywords.split(',').map((item) => item.trim()).filter(Boolean);
      if (form.type === 'keyword_whitelist') config.boost = form.boost;
    }
    if (form.type === 'ai_score_filter') {
      config.minAiScore = form.minAiScore;
      config.maxAiScore = form.maxAiScore;
      if (form.boost) config.boost = form.boost;
    }
    return config;
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.rules.create({
        name: form.name,
        type: form.type,
        config: buildConfig(),
        enabled: form.enabled,
        priority: form.priority,
        scope: form.scope,
      });
      setShowAdd(false);
      setForm({ ...DEFAULT_FORM, scope });
      setNotice(form.scope === 'global' ? '全局规则已创建' : '个人规则已创建');
      await fetchRules(form.scope);
    } catch (err) {
      setError((err as Error).message || '规则创建失败');
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await api.rules.update(rule.id, { enabled: !rule.enabled });
      await fetchRules();
    } catch (err) {
      setError((err as Error).message || '规则更新失败');
    }
  };

  const handleDelete = async (rule: Rule) => {
    if (!window.confirm(`确定删除规则“${rule.name}”？`)) return;
    try {
      await api.rules.delete(rule.id);
      setNotice('规则已删除');
      await fetchRules();
    } catch (err) {
      setError((err as Error).message || '规则删除失败');
    }
  };

  const activeScope = showAdd ? form.scope : scope;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">规则中心</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {activeScope === 'global' ? '管理员可维护对所有用户生效的全局规则。' : '个人规则只影响当前账号的过滤与加权。'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex rounded-xl bg-zinc-100 p-1">
              {(['user', 'global'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setScope(item);
                    setForm((prev) => ({ ...prev, scope: item }));
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    scope === item ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  {item === 'user' ? '个人规则' : '全局规则'}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setShowAdd((prev) => !prev);
              setForm((prev) => ({ ...prev, scope }));
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-zinc-900 text-white rounded-xl hover:bg-zinc-800"
          >
            <Plus size={14} />
            添加规则
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800">新建规则</h2>
              <p className="text-xs text-zinc-500 mt-1">Rules 负责硬过滤和加权；评分 Skills 负责智能评分与个性化判断。AI 评分门槛在评分后生效；关键词黑名单会直接过滤，白名单会加分。优先级数字越小越先执行。</p>
            </div>
            {isAdmin && form.scope === 'global' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] text-amber-700">
                <Shield size={12} />
                全局规则
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="规则名称"
              required
              className="px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
              className="px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
            >
              {RULE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">作用域</span>
              <div className="flex rounded-xl bg-white border border-zinc-200 p-1">
                {(['user', 'global'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, scope: item }))}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      form.scope === item ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    {item === 'user' ? '个人' : '全局'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.type.includes('keyword') && (
            <div className="space-y-2">
              <input
                value={form.keywords}
                onChange={(e) => setForm((prev) => ({ ...prev, keywords: e.target.value }))}
                placeholder="关键词（逗号分隔，如：AI,创业,融资）"
                className="w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm"
              />
              {form.type === 'keyword_blacklist' && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, keywords: NON_AI_NOISE_PRESET }))}
                  className="text-xs text-zinc-600 hover:text-zinc-900"
                >
                  填入“过滤非 AI 噪音词”推荐预设
                </button>
              )}
              {form.type === 'keyword_whitelist' && (
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                  加分值
                  <input
                    type="number"
                    value={form.boost}
                    onChange={(e) => setForm((prev) => ({ ...prev, boost: Number(e.target.value || 0) }))}
                    className="w-24 px-2 py-1.5 border border-zinc-200 rounded-lg text-sm"
                  />
                </label>
              )}
            </div>
          )}

          {form.type === 'ai_score_filter' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:max-w-2xl">
              <label className="text-xs text-zinc-500">
                最低 AI 分数
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.minAiScore}
                  onChange={(e) => setForm((prev) => ({ ...prev, minAiScore: Number(e.target.value || 0) }))}
                  className="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500">
                最高 AI 分数
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.maxAiScore}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxAiScore: Number(e.target.value || 100) }))}
                  className="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm"
                />
              </label>
              <label className="text-xs text-zinc-500">
                额外加分（可选）
                <input
                  type="number"
                  value={form.boost}
                  onChange={(e) => setForm((prev) => ({ ...prev, boost: Number(e.target.value || 0) }))}
                  className="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:max-w-sm">
            <label className="text-xs text-zinc-500">
              优先级
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value || 0) }))}
                className="mt-1 w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm"
              />
            </label>
            <label className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-3 py-2 mt-5 text-sm text-zinc-700">
              启用
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-xl hover:bg-zinc-800">
              保存规则
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700">
              取消
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-20 text-zinc-400">加载中...</div>
      ) : rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white py-20 text-center text-zinc-400">
          暂无{scope === 'global' ? '全局' : '个人'}规则
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
              <div className="flex items-start gap-3">
                <button onClick={() => void handleToggle(rule)} className="mt-0.5 shrink-0">
                  {rule.enabled ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} className="text-zinc-300" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${rule.enabled ? 'text-zinc-900' : 'text-zinc-400'}`}>{rule.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">
                      {RULE_TYPES.find((item) => item.value === rule.type)?.label || rule.type}
                    </span>
                    {rule.scope === 'global' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">全局</span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">优先级 {rule.priority}</span>
                  </div>

                  {rule.config?.keywords && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {(rule.config.keywords as string[]).slice(0, 12).map((keyword) => (
                        <span key={keyword} className="text-[10px] px-2 py-0.5 border border-zinc-200 bg-zinc-50 rounded-full">{keyword}</span>
                      ))}
                    </div>
                  )}
                  {rule.type === 'ai_score_filter' && (
                    <p className="mt-2 text-xs text-zinc-500">
                      AI 分数范围：{rule.config.minAiScore ?? 0} - {rule.config.maxAiScore ?? 100}
                      {typeof rule.config.boost === 'number' && rule.config.boost !== 0 ? ` · 额外加分 ${rule.config.boost}` : ''}
                    </p>
                  )}
                </div>
                <button onClick={() => void handleDelete(rule)} className="p-1.5 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} className="text-zinc-300 hover:text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
