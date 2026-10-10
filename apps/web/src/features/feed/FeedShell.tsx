import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { feedWorkbenchGridClassName } from '../../lib/feed-layout';
import type { NoticeTone } from '../../lib/feed-diagnostics';
import { useKeyboardNavigation } from '../../lib/use-keyboard-navigation';
import { KeyboardShortcutsDialog } from '../../components/KeyboardShortcutsDialog';
import { FeedSourceRail } from './source-rail';
import { FeedItemQueue } from './item-queue';
import { FeedToolbar } from './FeedToolbar';
import { FeedDetail } from './FeedDetail';
import { useFeedContext } from './FeedContext';

const NOTICE_CLASS_NAMES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function FeedShell() {
  const ctx = useFeedContext();
  const navigate = useNavigate();
  const {
    items, total, loading, loadingMore, sourceId, stats, selectedId, nextPageOffset,
    mobileSourceOpen, setMobileSourceOpen, sourcePaneCollapsed, listPaneWidth,
    sourceRail, error, notice, listPanelRef,
    handleSelectSource, handleListPaneResizeStart, handleOpenDetail, handleFavorite,
    handleMarkRead, selectedItem,
    setSourceId, setOffset, updateListQuery,
  } = ctx;

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // 当前选中条目在列表中的索引
  const currentIndex = useMemo(
    () => selectedId ? items.findIndex((item) => item.id === selectedId) : -1,
    [items, selectedId],
  );

  // 键盘导航: 选择下一条
  const handleNext = useCallback(() => {
    if (items.length === 0) return;
    const nextIdx = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    void handleOpenDetail(items[nextIdx]);
  }, [currentIndex, items, handleOpenDetail]);

  // 键盘导航: 选择上一条
  const handlePrev = useCallback(() => {
    if (items.length === 0) return;
    const prevIdx = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    void handleOpenDetail(items[prevIdx]);
  }, [currentIndex, items, handleOpenDetail]);

  // Enter: 打开当前选中
  const handleOpen = useCallback(() => {
    if (selectedId && selectedItem) return; // 已在详情
    if (items.length > 0) {
      const idx = currentIndex >= 0 ? currentIndex : 0;
      void handleOpenDetail(items[idx]);
    }
  }, [selectedId, selectedItem, items, currentIndex, handleOpenDetail]);

  // Escape: 关闭详情 / 退出搜索
  const handleClose = useCallback(() => {
    if (selectedId) {
      navigate('/feed');
    }
  }, [selectedId, navigate]);

  // /: 聚焦搜索框
  const handleSearchFocus = useCallback(() => {
    const searchInput = document.querySelector<HTMLInputElement>('[data-feed-search-input]');
    searchInput?.focus();
  }, []);

  // m: 标记已读
  const handleMarkReadShortcut = useCallback(() => {
    if (selectedId) void handleMarkRead(selectedId);
  }, [selectedId, handleMarkRead]);

  // s: 收藏
  const handleFavoriteShortcut = useCallback(() => {
    if (selectedItem) void handleFavorite(selectedItem.id, selectedItem.isFavorite);
  }, [selectedItem, handleFavorite]);

  // ?: 打开帮助
  const handleHelp = useCallback(() => {
    setShortcutsOpen(true);
  }, []);

  useKeyboardNavigation({
    onNext: handleNext,
    onPrev: handlePrev,
    onOpen: handleOpen,
    onClose: handleClose,
    onSearch: handleSearchFocus,
    onMarkRead: handleMarkReadShortcut,
    onFavorite: handleFavoriteShortcut,
    onHelp: handleHelp,
  });

  const noticeMessage = typeof notice === 'string' ? notice : notice?.message;
  const noticeTone: NoticeTone = typeof notice === 'string' || !notice ? 'success' : notice.tone;

  const queueMeta = ctx.sortMode === 'latest'
    ? { title: '最新时间线' }
    : ctx.sortMode === 'score'
      ? { title: '高分优先' }
      : { title: '推荐阅读' };

  const workbenchGridStyle = {
    '--feed-source-width': '220px',
    '--feed-list-width': `${listPaneWidth}px`,
  } as CSSProperties;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f8f6] p-2 md:p-3 xl:flex xl:h-screen xl:min-h-0 xl:flex-col">
      <FeedToolbar />

      {error && (
        <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">{error}</div>
      )}
      {noticeMessage && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${NOTICE_CLASS_NAMES[noticeTone]}`}>{noticeMessage}</div>
      )}

      <div
        data-feed-workbench
        style={workbenchGridStyle}
        className={`${feedWorkbenchGridClassName} ${sourcePaneCollapsed ? 'xl:grid-cols-[var(--feed-list-width)_minmax(0,1fr)]' : 'xl:grid-cols-[var(--feed-source-width)_var(--feed-list-width)_minmax(0,1fr)]'}`}
      >
        <FeedSourceRail
          sources={sourceRail}
          selectedSourceId={sourceId}
          unreadTotal={stats?.unread ?? 0}
          mobileOpen={mobileSourceOpen}
          desktopCollapsed={sourcePaneCollapsed}
          onCloseMobile={() => setMobileSourceOpen(false)}
          onSelectAll={() => { setSourceId(''); setOffset(0); setMobileSourceOpen(false); updateListQuery({ sourceId: '' }); }}
          onSelectSource={handleSelectSource}
        />

        <FeedItemQueue
          panelRef={listPanelRef}
          title={queueMeta.title}
          items={items}
          total={total}
          loading={loading}
          loadingMore={loadingMore}
          sourceId={sourceId}
          stats={stats}
          selectedId={selectedId}
          nextPageOffset={nextPageOffset}
          viewMode={ctx.viewMode}
          onResizeStart={handleListPaneResizeStart}
          onOpen={(entry) => { void handleOpenDetail(entry); }}
          onFilterSource={(entry) => { if (!entry.sourceId) return; setSourceId(String(entry.sourceId)); setOffset(0); updateListQuery({ sourceId: String(entry.sourceId) }); }}
          onToggleFavorite={(entry) => { void handleFavorite(entry.id, entry.isFavorite); }}
          onMarkRead={(entry) => { void ctx.handleMarkRead(entry.id); }}
          onLoadMore={setOffset}
        />

        <FeedDetail />
      </div>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
