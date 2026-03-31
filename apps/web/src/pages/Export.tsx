import { useState } from 'react';
import { api, type ExportMutationResult } from '../lib/api';
import { Download, FileText, FolderOpen } from 'lucide-react';

type ExportKind = 'obsidian' | 'knowledge' | 'markdown';

export function Export() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const handleExport = async (type: ExportKind) => {
    setLoading(type);
    try {
      switch (type) {
        case 'obsidian': {
          const res: ExportMutationResult = await api.export.obsidian();
          setResults(r => ({ ...r, obsidian: `导出 ${res.exported ?? 0} 个文件` }));
          break;
        }
        case 'knowledge': {
          const res: ExportMutationResult = await api.export.knowledge();
          setResults(r => ({ ...r, knowledge: `导出 ${res.exported ?? 0} 个文件` }));
          break;
        }
        case 'markdown': {
          const md = await api.export.markdown();
          const blob = new Blob([md], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `daily-report-${new Date().toISOString().split('T')[0]}.md`;
          a.click();
          URL.revokeObjectURL(url);
          setResults(r => ({ ...r, markdown: '已下载到本地' }));
          break;
        }
      }
    } catch (err) {
      setResults(r => ({ ...r, [type]: `失败: ${(err as Error).message}` }));
    } finally {
      setLoading(null);
    }
  };

  const exports = [
    { id: 'obsidian' as const, title: 'Obsidian 导出', desc: '增量导出到 Obsidian vault（Inbox/Podcasts + sync-index）', icon: FolderOpen },
    { id: 'knowledge' as const, title: '知识库文件导出', desc: '结构化 Markdown 文件（带 frontmatter）到 data/knowledge/', icon: FileText },
    { id: 'markdown' as const, title: 'Markdown 日报下载', desc: '下载当日日报 Markdown 文件到本地', icon: Download },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-zinc-900 mb-2">导出</h1>
      <p className="text-sm text-zinc-500 mb-6">将信息中枢数据导出到知识库或本地文件</p>

      <div className="space-y-3">
        {exports.map(({ id, title, desc, icon: Icon }) => (
          <div key={id} className="flex items-center gap-4 p-4 rounded-xl border border-zinc-200 hover:border-zinc-300 transition-colors">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
              <Icon size={20} className="text-zinc-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-zinc-900">{title}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
              {results[id] && <p className="text-xs text-emerald-600 mt-1">{results[id]}</p>}
            </div>
            <button
              onClick={() => handleExport(id)}
              disabled={loading === id}
              className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50 shrink-0"
            >
              {loading === id ? '导出中...' : '导出'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
