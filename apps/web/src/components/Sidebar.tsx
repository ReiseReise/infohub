import { NavLink } from 'react-router-dom';
import { Newspaper, Radio, Settings, BarChart3, Download, Filter, Upload, Mic, Globe, Archive } from 'lucide-react';
import { useAuth } from '../lib/use-auth';

const navItems = [
  { to: '/insights', label: '成长仪表板', icon: BarChart3 },
  { to: '/feed', label: '信息流', icon: Newspaper },
  { to: '/podcast', label: '播客专栏', icon: Mic },
  { to: '/audio', label: '音频工坊', icon: Upload },
  { to: '/sources', label: '信源管理', icon: Radio },
  { to: '/monitor', label: '网页监控', icon: Globe },
  { to: '/rules', label: '过滤策略', icon: Filter },
  { to: '/filtered', label: '过滤池', icon: Archive },
  { to: '/export', label: '导出', icon: Download },
  { to: '/settings', label: '设置', icon: Settings },
];

export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-zinc-200">
        <h1 className="text-lg font-bold text-zinc-900 tracking-tight">信息中枢</h1>
        <p className="text-xs text-zinc-500 mt-0.5">v3.1 · 成长导向中枢</p>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-zinc-900 text-white font-medium'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-zinc-200">
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
