export type SourceViewMode = 'cards' | 'table';

export function resolveInitialSourcesViewMode(viewportWidth?: number): SourceViewMode {
  const width = viewportWidth ?? (
    typeof window !== 'undefined' && typeof window.innerWidth === 'number'
      ? window.innerWidth
      : 1024
  );
  return width < 768 ? 'cards' : 'table';
}
