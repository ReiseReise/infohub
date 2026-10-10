import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_READER_PREFERENCES,
  READER_PREFERENCES_STORAGE_KEY,
  loadReaderPreferences,
  normalizeReaderPreferences,
  readerFontFamilyCss,
  saveReaderPreferences,
} from '../src/lib/reader-preferences.ts';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem(key: string) {
      return key === READER_PREFERENCES_STORAGE_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key === READER_PREFERENCES_STORAGE_KEY) value = next;
    },
    value: () => value,
  };
}

test('normalizes unsupported reader settings to readable defaults', () => {
  assert.deepEqual(normalizeReaderPreferences({
    width: 1200,
    fontSize: 9,
    lineHeight: 1,
    fontFamily: 'comic',
  }), DEFAULT_READER_PREFERENCES);
});

test('persists and restores reader width and typography choices', () => {
  const storage = memoryStorage();
  const saved = saveReaderPreferences({
    width: 860,
    fontSize: 20,
    lineHeight: 2.05,
    fontFamily: 'serif',
  }, storage);

  assert.deepEqual(loadReaderPreferences(storage), saved);
  assert.match(storage.value() || '', /"width":860/);
});

test('maps reader font choices to resilient system font stacks', () => {
  assert.match(readerFontFamilyCss('serif'), /Georgia/);
  assert.match(readerFontFamilyCss('sans'), /system-ui/);
});
