import React from 'react';
import ReactDOM from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Radius} from './pages/Radius';
import {getStoredToken} from './lib/auth-storage';
import './index.css';

const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}>
  <div className="min-h-screen bg-zinc-50 text-zinc-900"><nav className="border-b border-zinc-200 bg-white px-4 py-3 text-sm"><a href="/feed" className="text-zinc-600 hover:underline">← 返回信息中枢</a></nav>
  {getStoredToken()?<Radius/>:<div className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-semibold">我的信息半径</h1><p>请先登录信息中枢，再打开你的私有内容库。</p><a className="underline" href="/login">前往登录</a></div>}</div>
</QueryClientProvider></React.StrictMode>);
