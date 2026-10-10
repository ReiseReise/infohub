import { NavLink, useLocation } from 'react-router-dom';
import { Newspaper, FileText, Radio, Settings } from 'lucide-react';
import { motion } from 'framer-motion';

const tabs = [
  { to: '/feed', label: '信息流', icon: Newspaper },
  { to: '/daily/reports/latest', label: '日报', icon: FileText },
  { to: '/sources', label: '信源', icon: Radio },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

export function MobileTabBar() {
  const location = useLocation();
  const activeIndex = tabs.findIndex((tab) =>
    location.pathname.startsWith(tab.to)
  );

  return (
    <nav
      aria-label="移动端底部导航"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="relative flex items-center justify-around px-2 py-1">
        {/* Animated indicator */}
        {activeIndex >= 0 && (
          <motion.div
            className="absolute top-0 h-0.5 rounded-full bg-teal-500"
            layoutId="mobile-tab-indicator"
            style={{ width: `${100 / tabs.length}%`, left: `${(activeIndex / tabs.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                isActive ? 'text-teal-600 font-medium' : 'text-zinc-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <motion.div
                  animate={{ scale: isActive ? 1.1 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                </motion.div>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
