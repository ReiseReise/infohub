import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { GlobalUploadBanner } from './GlobalUploadBanner';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <GlobalUploadBanner />
    </div>
  );
}
