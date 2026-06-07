export function resolveFeedDetailOrderClassName(hasSelectedItem: boolean): string {
  return hasSelectedItem ? 'order-first xl:order-none' : '';
}

export function shouldAutoScrollFeedDetailIntoView(hasSelectedItem: boolean, viewportWidth?: number): boolean {
  if (!hasSelectedItem) return false;
  const width = viewportWidth ?? (
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 1280
  );
  return width < 1280;
}

export const feedDetailHeaderClassName = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';
