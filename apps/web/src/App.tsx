import Jev from './pages/Jev';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './lib/use-auth';
import { isAdminRole } from './lib/access-control';

const Feed = lazy(() => import('./pages/Feed').then((module) => ({ default: module.Feed })));
const Sources = lazy(() => import('./pages/Sources').then((module) => ({ default: module.Sources })));
const Insights = lazy(() => import('./pages/Insights').then((module) => ({ default: module.Insights })));
const Reports = lazy(() => import('./pages/Reports').then((module) => ({ default: module.Reports })));
const Research = lazy(() => import('./pages/Research').then((module) => ({ default: module.Research })));
const Radius = lazy(() => import('./pages/Radius').then((module) => ({ default: module.Radius })));
const DailyWorkbench = lazy(() => import('./pages/Daily').then((module) => ({ default: module.DailyWorkbench })));
const DailyWorkflows = lazy(() => import('./pages/DailyWorkflows').then((module) => ({ default: module.DailyWorkflows })));
const DailyCandidates = lazy(() => import('./pages/DailyCandidates').then((module) => ({ default: module.DailyCandidates })));
const DailyLatestReport = lazy(() => import('./pages/DailyLatestReport').then((module) => ({ default: module.DailyLatestReport })));
const Export = lazy(() => import('./pages/Export').then((module) => ({ default: module.Export })));
const Monitor = lazy(() => import('./pages/Monitor').then((module) => ({ default: module.Monitor })));
const Rules = lazy(() => import('./pages/Rules').then((module) => ({ default: module.Rules })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Admin = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Admin })));
const AudioStudio = lazy(() => import('./pages/AudioStudio').then((module) => ({ default: module.AudioStudio })));
const AiUsage = lazy(() => import('./pages/AiUsage').then((module) => ({ default: module.AiUsage })));
const PodcastHub = lazy(() => import('./pages/PodcastHub').then((module) => ({ default: module.PodcastHub })));
const Filtered = lazy(() => import('./pages/Filtered').then((module) => ({ default: module.Filtered })));
const ReaderLab = lazy(() => import('./pages/ReaderLab').then((module) => ({ default: module.ReaderLab })));
const ReaderLabSetup = lazy(() => import('./pages/ReaderLab').then((module) => ({ default: module.ReaderLabSetup })));
const ReaderLabCompare = lazy(() => import('./pages/ReaderLab').then((module) => ({ default: module.ReaderLabCompare })));
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then((module) => ({ default: module.Register })));

function FullscreenStatus({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-500 text-sm">
      {message}
    </div>
  );
}

type AppErrorBoundaryState = {
  error: Error | null;
};

function isChunkLoadError(error: Error) {
  return /(?:chunk|module|import).*(?:load|fetch)|failed to fetch dynamically imported module/i.test(error.message);
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app-render-error]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const isChunkError = isChunkLoadError(error);
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-zinc-900">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-600">信息中枢</p>
          <h1 className="mt-3 text-xl font-semibold">{isChunkError ? '页面版本已更新' : '页面加载失败'}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {isChunkError
              ? '当前页面引用了旧资源，请刷新后继续使用。'
              : '页面出现了异常，刷新后通常可以恢复。若问题持续，请联系管理员。'}
          </p>
          <button
            type="button"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
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
    return <Navigate to="/feed" replace />;
  }
  return children;
}

function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullscreenStatus message="正在确认管理员权限..." />;
  }
  if (!isAdminRole(user?.role)) {
    return <Navigate to="/feed" replace />;
  }
  return <Outlet />;
}

function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <Suspense fallback={<FullscreenStatus message="正在打开页面..." />}>
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
              <Route path="/reports" element={<Reports />} />
              <Route path="/research" element={<Research />} />
              <Route path="/radius" element={<Radius />} />
              <Route path="/daily/workbench" element={<DailyWorkbench />} />
              <Route path="/daily/workflows" element={<DailyWorkflows />} />
              <Route path="/daily/candidates" element={<DailyCandidates />} />
              <Route path="/daily/reports/latest" element={<DailyLatestReport />} />
              <Route path="/export" element={<Export />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/filtered" element={<Filtered />} />
              <Route path="/audio" element={<AudioStudio />} />
              <Route path="/reader-lab" element={<ReaderLab />} />
              <Route path="/reader-lab/setup" element={<ReaderLabSetup />} />
              <Route path="/reader-lab/compare" element={<ReaderLabCompare />} />
              <Route path="/settings" element={<Settings />} />
              <Route element={<RequireAdmin />}>
                <Route path="/jev" element={<Jev />} />
                <Route path="/ai-usage" element={<AiUsage />} />
                <Route path="/admin" element={<Admin />} />
              </Route>
              <Route path="/" element={<Navigate to="/feed" replace />} />
              <Route path="*" element={<Navigate to="/feed" replace />} />
            </Route>
          </Route>
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
