import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { GlobalUploadBanner } from './GlobalUploadBanner';

export function Layout() {
  return (
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <GlobalUploadBanner />
    </div>
  );
}
