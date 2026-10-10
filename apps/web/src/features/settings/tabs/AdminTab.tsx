import { useCallback, useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { api, type AdminDashboardStats, type AdminTask, type AdminUser, type AdminInviteCode } from '../../../lib/api';
import { useSettings } from '../SettingsContext';
import { ADMIN_TAB_LABELS, type AdminTab as AdminTabKey } from '../shared';

export function AdminTab() {
  const { isAdmin, setError, setNotice } = useSettings();
  const [loading, setLoading] = useState(true);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTabKey>('dashboard');
  const [adminStats, setAdminStats] = useState<AdminDashboardStats | null>(null);
  const [adminTasks, setAdminTasks] = useState<AdminTask[]>([]);
  const [adminTaskTotal, setAdminTaskTotal] = useState(0);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminInvites, setAdminInvites] = useState<AdminInviteCode[]>([]);
  const [adminTaskStatus, setAdminTaskStatus] = useState('');
  const [adminTaskSearch, setAdminTaskSearch] = useState('');

  const refreshAdmin = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [statsResp, tasksResp, usersResp, invitesResp] = await Promise.all([
        api.admin.dashboardStats(),
        api.admin.listTasks({ page: 1, page_size: 20, status: adminTaskStatus || undefined, search: adminTaskSearch || undefined }),
        api.admin.listUsers(),
        api.admin.listInviteCodes(),
      ]);
      setAdminStats(statsResp);
      setAdminTasks(tasksResp.items || []);
      setAdminTaskTotal(tasksResp.total || 0);
      setAdminUsers(usersResp || []);
      setAdminInvites(invitesResp || []);
    } catch (err) {
      setError((err as Error).message || '加载后台数据失败');
    } finally {
      setLoading(false);
    }
  }, [adminTaskSearch, adminTaskStatus, isAdmin, setError]);

  useEffect(() => { void refreshAdmin(); }, [refreshAdmin]);

  const updateAdminUser = async (target: AdminUser, patch: Partial<{ is_active: boolean; role: string; quota_seconds_monthly: number }>) => {
    try {
      await api.admin.updateUser(target.id, patch);
      await refreshAdmin();
      setNotice('用户已更新');
    } catch (err) {
      setError((err as Error).message || '更新用户失败');
    }
  };

  const removeAdminUser = async (target: AdminUser) => {
    if (!window.confirm(`确认删除用户 ${target.username} ?`)) return;
    try {
      await api.admin.deleteUser(target.id);
      await refreshAdmin();
      setNotice('用户已删除');
    } catch (err) {
      setError((err as Error).message || '删除用户失败');
    }
  };

  const createInviteCode = async () => {
    try {
      await api.admin.createInviteCode({ max_uses: 5, expires_days: 30 });
      await refreshAdmin();
      setNotice('邀请码已创建');
    } catch (err) {
      setError((err as Error).message || '创建邀请码失败');
    }
  };

  const reprocessTask = async (taskId: string) => {
    try {
      await api.admin.reprocessTask(taskId);
      await refreshAdmin();
      setNotice('任务已重新提交');
    } catch (err) {
      setError((err as Error).message || '重跑任务失败');
    }
  };

  if (!isAdmin) return <div className="text-sm text-zinc-500">仅管理员可访问。</div>;

  if (loading) {
    return <div className="py-10 text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />加载中...</div>;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={16} className="text-zinc-700" />
        <h2 className="text-sm font-semibold text-zinc-800">管理后台（管理员）</h2>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {ADMIN_TAB_LABELS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveAdminTab(tab.key)}
            className={`min-h-9 px-3 py-2 text-sm rounded-lg border transition-colors ${activeAdminTab === tab.key ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeAdminTab === 'dashboard' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="text-xl font-bold text-zinc-900">{adminStats?.total_tasks ?? 0}</div>
            <div className="text-xs text-zinc-500">任务总数</div>
          </div>
          <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="text-xl font-bold text-zinc-900">{adminStats?.today_tasks ?? 0}</div>
            <div className="text-xs text-zinc-500">今日新增</div>
          </div>
          <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="text-xl font-bold text-zinc-900">{adminStats?.total_users ?? 0}</div>
            <div className="text-xs text-zinc-500">用户总数</div>
          </div>
          <div className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
            <div className="text-xl font-bold text-zinc-900">{adminStats?.month_cost ?? 0}</div>
            <div className="text-xs text-zinc-500">本月费用</div>
          </div>
        </div>
      )}

      {activeAdminTab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select aria-label="管理任务状态" value={adminTaskStatus} onChange={(e) => setAdminTaskStatus(e.target.value)} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg">
              <option value="">全部状态</option>
              <option value="uploading">uploading</option>
              <option value="transcribing">transcribing</option>
              <option value="summarizing">summarizing</option>
              <option value="generating">generating</option>
              <option value="done">done</option>
              <option value="failed">failed</option>
            </select>
            <input
              value={adminTaskSearch}
              onChange={(e) => setAdminTaskSearch(e.target.value)}
              placeholder="搜索任务或用户"
              className="px-3 py-2 text-sm border border-zinc-200 rounded-lg flex-1"
            />
            <button onClick={() => void refreshAdmin()} className="px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50">搜索</button>
          </div>
          <p className="text-xs text-zinc-500">共 {adminTaskTotal} 条</p>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {adminTasks.map((task) => (
              <div key={task.id} className="border border-zinc-100 rounded-lg px-3 py-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-800 truncate">{task.title}</div>
                  <div className="text-xs text-zinc-500">{task.user?.email || '-'} · {task.status} · {task.created_at}</div>
                </div>
                <button onClick={() => void reprocessTask(task.id)} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">重跑</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeAdminTab === 'users' && (
        <div className="space-y-2 max-h-[460px] overflow-y-auto">
          {adminUsers.map((u) => (
            <div key={u.id} className="border border-zinc-100 rounded-lg px-3 py-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-800">{u.username} <span className="text-zinc-500">({u.email})</span></div>
                  <div className="text-xs text-zinc-500">role: {u.role} · active: {String(u.is_active)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void updateAdminUser(u, { is_active: !u.is_active })} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">
                    {u.is_active ? '禁用' : '启用'}
                  </button>
                  <button onClick={() => void updateAdminUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50">
                    切换角色
                  </button>
                  <button onClick={() => void removeAdminUser(u)} className="inline-flex min-h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-50">
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeAdminTab === 'invites' && (
        <div className="space-y-3">
          <button onClick={() => void createInviteCode()} className="px-3 py-2 text-sm rounded-lg bg-zinc-900 text-white">创建邀请码</button>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {adminInvites.map((code) => (
              <div key={code.id} className="border border-zinc-100 rounded-lg px-3 py-2">
                <div className="text-sm font-medium text-zinc-800">{code.code}</div>
                <div className="text-xs text-zinc-500">使用 {code.used_count}/{code.max_uses} · 过期 {code.expires_at || '无'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
