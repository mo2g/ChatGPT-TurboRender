import { describe, expect, it } from 'vitest';

import {
  createTranslator,
  getCatalogKeys,
  normalizeLanguagePreference,
  resolveUiLanguage,
  translate,
} from '../../lib/shared/i18n';

describe('i18n helpers', () => {
  it('normalizes supported language preferences and falls back to auto', () => {
    expect(normalizeLanguagePreference('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguagePreference('en')).toBe('en');
    expect(normalizeLanguagePreference('fr')).toBe('auto');
  });

  it('resolves UI language from browser and page hints', () => {
    expect(resolveUiLanguage('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveUiLanguage('auto', 'en-US')).toBe('en');
    expect(resolveUiLanguage('zh-CN', 'en-US')).toBe('zh-CN');
  });

  it('keeps message catalogs aligned across supported languages', () => {
    const keys = getCatalogKeys();

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(translate('en', key)).not.toHaveLength(0);
      expect(translate('zh-CN', key)).not.toHaveLength(0);
    }
  });

  it('interpolates message variables', () => {
    const t = createTranslator('en');
    expect(t('statusShelfManaged', { count: 12 })).toContain('12');
  });
});
