import { useEffect } from 'react';

export interface KeyboardNavigationHandlers {
  onNext?: () => void;       // j or ArrowDown
  onPrev?: () => void;       // k or ArrowUp
  onOpen?: () => void;       // Enter
  onClose?: () => void;      // Escape
  onSearch?: () => void;     // /
  onMarkRead?: () => void;   // m
  onFavorite?: () => void;   // s
  onHelp?: () => void;       // ?
}

/**
 * 判断当前焦点是否在输入控件内（input/textarea/contenteditable），
 * 此时不应该触发全局快捷键。
 */
function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * 全局键盘快捷键 hook。
 * 只在没有输入控件聚焦时响应，避免干扰用户正常输入。
 */
export function useKeyboardNavigation(handlers: KeyboardNavigationHandlers) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // 不干扰输入框
      if (isEditableTarget(event)) return;
      // 忽略 Meta/Ctrl/Alt 组合键
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          if (handlers.onNext) { event.preventDefault(); handlers.onNext(); }
          break;
        case 'k':
        case 'ArrowUp':
          if (handlers.onPrev) { event.preventDefault(); handlers.onPrev(); }
          break;
        case 'Enter':
          if (handlers.onOpen) { event.preventDefault(); handlers.onOpen(); }
          break;
        case 'Escape':
          if (handlers.onClose) { event.preventDefault(); handlers.onClose(); }
          break;
        case '/':
          if (handlers.onSearch) { event.preventDefault(); handlers.onSearch(); }
          break;
        case 'm':
          if (handlers.onMarkRead) { event.preventDefault(); handlers.onMarkRead(); }
          break;
        case 's':
          if (handlers.onFavorite) { event.preventDefault(); handlers.onFavorite(); }
          break;
        case '?':
          if (handlers.onHelp) { event.preventDefault(); handlers.onHelp(); }
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlers]);
}
