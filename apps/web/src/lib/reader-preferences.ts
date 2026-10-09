export type ReaderWidth = 760 | 820 | 860;
export type ReaderFontSize = 16 | 17 | 18 | 20;
export type ReaderLineHeight = 1.75 | 1.9 | 2.05;
export type ReaderFontFamily = 'sans' | 'serif';

export type ReaderPreferences = {
  width: ReaderWidth;
  fontSize: ReaderFontSize;
  lineHeight: ReaderLineHeight;
  fontFamily: ReaderFontFamily;
};

type ReaderPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const READER_PREFERENCES_STORAGE_KEY = 'infohub.reader.preferences.v1';

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  width: 820,
  fontSize: 17,
  lineHeight: 1.9,
  fontFamily: 'sans',
};

export const READER_WIDTH_OPTIONS: ReaderWidth[] = [760, 820, 860];
export const READER_FONT_SIZE_OPTIONS: ReaderFontSize[] = [16, 17, 18, 20];
export const READER_LINE_HEIGHT_OPTIONS: ReaderLineHeight[] = [1.75, 1.9, 2.05];

function allowedNumber<T extends number>(value: unknown, options: T[], fallback: T): T {
  const normalized = Number(value);
  return options.includes(normalized as T) ? normalized as T : fallback;
}

export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const input = value && typeof value === 'object' ? value as Partial<ReaderPreferences> : {};
  return {
    width: allowedNumber(input.width, READER_WIDTH_OPTIONS, DEFAULT_READER_PREFERENCES.width),
    fontSize: allowedNumber(input.fontSize, READER_FONT_SIZE_OPTIONS, DEFAULT_READER_PREFERENCES.fontSize),
    lineHeight: allowedNumber(input.lineHeight, READER_LINE_HEIGHT_OPTIONS, DEFAULT_READER_PREFERENCES.lineHeight),
    fontFamily: input.fontFamily === 'serif' ? 'serif' : 'sans',
  };
}

function browserStorage(): ReaderPreferenceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadReaderPreferences(storage = browserStorage()): ReaderPreferences {
  if (!storage) return DEFAULT_READER_PREFERENCES;
  try {
    const raw = storage.getItem(READER_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeReaderPreferences(JSON.parse(raw)) : DEFAULT_READER_PREFERENCES;
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(preferences: ReaderPreferences, storage = browserStorage()): ReaderPreferences {
  const normalized = normalizeReaderPreferences(preferences);
  try {
    storage?.setItem(READER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Reading should remain usable when storage is unavailable.
  }
  return normalized;
}

export function readerFontFamilyCss(fontFamily: ReaderFontFamily): string {
  return fontFamily === 'serif'
    ? 'ui-serif, Georgia, Cambria, "Times New Roman", serif'
    : 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}
