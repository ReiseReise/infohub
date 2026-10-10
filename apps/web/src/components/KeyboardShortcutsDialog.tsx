import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

const SHORTCUT_GROUPS = [
  {
    title: '导航',
    shortcuts: [
      { keys: ['j', '↓'], description: '下一条 / 下一章节' },
      { keys: ['k', '↑'], description: '上一条 / 上一章节' },
      { keys: ['Enter'], description: '打开选中条目' },
      { keys: ['Escape'], description: '关闭详情 / 退出搜索' },
    ],
  },
  {
    title: '操作',
    shortcuts: [
      { keys: ['/'], description: '聚焦搜索框' },
      { keys: ['m'], description: '标记当前条目为已读' },
      { keys: ['s'], description: '收藏 / 取消收藏' },
    ],
  },
  {
    title: '帮助',
    shortcuts: [
      { keys: ['?'], description: '打开快捷键帮助' },
    ],
  },
];

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>使用以下快捷键快速浏览和操作内容。</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{group.title}</h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.description} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50">
                    <span className="text-zinc-700">{shortcut.description}</span>
                    <span className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && <span className="mx-0.5 text-zinc-300">/</span>}
                          <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
