import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { Feed } from './pages/Feed';
import { Sources } from './pages/Sources';
import { Insights } from './pages/Insights';
import { Export } from './pages/Export';
import { Monitor } from './pages/Monitor';
import { Rules } from './pages/Rules';
import { Settings } from './pages/Settings';
import { AudioStudio } from './pages/AudioStudio';
import { PodcastHub } from './pages/PodcastHub';
import { Filtered } from './pages/Filtered';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { useAuth } from './lib/use-auth';

function FullscreenStatus({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-500 text-sm">
      {message}
    </div>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullscreenStatus message="正在加载会话..." />;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullscreenStatus message="正在加载会话..." />;
  }
  if (user) {
    return <Navigate to="/insights" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/feed" element={<Feed />} />
            <Route path="/feed/:id" element={<Feed />} />
            <Route path="/podcast" element={<PodcastHub />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/export" element={<Export />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/filtered" element={<Filtered />} />
            <Route path="/audio" element={<AudioStudio />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/" element={<Navigate to="/insights" replace />} />
            <Route path="*" element={<Navigate to="/insights" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
