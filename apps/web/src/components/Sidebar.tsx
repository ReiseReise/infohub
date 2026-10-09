import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Newspaper, Radio, Settings, BarChart3, Download, Filter, Upload, Mic, Globe, Archive, FileText, Activity, FlaskConical, Menu, X, Shield } from 'lucide-react';
import { useAuth } from '../lib/use-auth';
import { isAdminRole } from '../lib/access-control';

const navGroups = [
  {
    label: '消费',
    items: [
      { to: '/insights', label: '成长仪表板', icon: BarChart3 },
      { to: '/feed', label: '信息流', icon: Newspaper },
      { to: '/radius', label: '我的信息半径', icon: Globe },
      { to: '/daily/reports/latest', label: '日报', icon: FileText },
      { to: '/research', label: '可信日报与研究', icon: FlaskConical },
      { to: '/podcast', label: '播客专栏', icon: Mic },
    ],
  },
  {
    label: '治理',
    items: [
      { to: '/sources', label: '信源管理', icon: Radio },
      { to: '/monitor', label: '网页监控', icon: Globe },
      { to: '/rules', label: '过滤策略', icon: Filter },
      { to: '/filtered', label: '过滤池', icon: Archive },
    ],
  },
  {
    label: '工具',
    items: [
      { to: '/audio', label: '音频工坊', icon: Upload },
      { to: '/export', label: '导出', icon: Download },
      { to: '/reader-lab', label: '阅读实验室', icon: FlaskConical },
    ],
  },
  {
    label: '后台',
    items: [
      { to: '/ai-usage', label: '模型用量', icon: Activity, adminOnly: true },
      { to: '/admin', label: '管理后台', icon: Shield, adminOnly: true },
      { to: '/settings', label: '设置', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-zinc-200 bg-zinc-50 md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 md:block md:py-5">
        <div>
          <h1 className="text-lg font-bold text-zinc-900 tracking-tight">信息中枢</h1>
          <p className="text-xs text-zinc-500 mt-0.5">v3.1 · 成长导向中枢</p>
        </div>
        <button
          type="button"
          aria-label={mobileNavOpen ? '收起主导航' : '展开主导航'}
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          title={mobileNavOpen ? '收起主导航' : '展开主导航'}
          onClick={() => setMobileNavOpen((open) => !open)}
          className="inline-flex size-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 md:hidden"
        >
          {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <nav
        id="primary-navigation"
        aria-label="主导航"
        className={`${mobileNavOpen ? 'block' : 'hidden'} px-2 py-2 md:block md:flex-1 md:overflow-y-auto md:py-3`}
      >
        {navGroups.map((group, groupIdx) => (
          <div key={group.label} className={groupIdx > 0 ? 'mt-2 border-t border-zinc-200 pt-2' : ''}>
            <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-zinc-400">{group.label}</p>
            <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
              {group.items.filter((item) => !('adminOnly' in item) || !item.adminOnly || isAdminRole(user?.role)).map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-colors md:justify-start md:gap-2.5 md:px-3 md:text-sm ${
                      isActive
                        ? 'bg-zinc-900 text-white font-medium'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                    }`
                  }
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="min-w-0 whitespace-nowrap">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="hidden border-t border-zinc-200 px-3 py-3 md:block">
        <p className="text-[10px] text-zinc-400 text-center">24/7 自动采集运行中</p>
        {user && (
          <div className="mt-2 px-2 py-2 rounded bg-white border border-zinc-200">
            <p className="text-[11px] text-zinc-700 truncate">{user.username}</p>
            <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
            <button
              onClick={logout}
              className="mt-2 w-full text-[11px] py-1 rounded bg-zinc-900 text-white hover:bg-zinc-800"
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
