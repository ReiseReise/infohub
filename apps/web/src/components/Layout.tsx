import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileTabBar } from './MobileTabBar';
import { GlobalUploadBanner } from './GlobalUploadBanner';
import { SkipNavLink } from './SkipNavLink';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      <SkipNavLink />
      <Sidebar />
      <main id="main-content" className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>
      <MobileTabBar />
      <GlobalUploadBanner />
    </div>
  );
}
