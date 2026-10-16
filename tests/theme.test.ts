import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  parseThemePreference,
  resolveTheme,
  themeColorScheme,
  themeIds,
  themeOptions,
  THEME_STORAGE_KEY,
} from '../src/lib/theme';

function startupScript() {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script, 'index.html should contain the prepaint theme bootstrap');
  return script;
}

function runStartup(saved: string | null, systemDark: boolean, storageThrows = false) {
  const state = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const localStorage = {
    getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (storageThrows) throw new Error('storage is unavailable');
      return saved;
    },
  };
  const window = {
    matchMedia(query: string) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return { matches: systemDark };
    },
  };
  vm.runInNewContext(startupScript(), {
    localStorage,
    window,
    document: { documentElement: state },
  });
  return state;
}

test('invalid preferences and runtime inputs fall back to dark safely', () => {
  for (const invalid of [null, undefined, '', 'sepia', 4, {}, false]) {
    assert.equal(parseThemePreference(invalid), 'dark');
  }
  assert.equal(resolveTheme(parseThemePreference('invalid'), true), 'dark');
  assert.equal(themeColorScheme('dark'), 'dark');
});

test('system preference follows both OS color modes and explicit themes ignore OS mode', () => {
  assert.equal(parseThemePreference('system'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');

  for (const theme of themeIds) {
    assert.equal(resolveTheme(theme, true), theme);
    assert.equal(resolveTheme(theme, false), theme);
  }
  assert.equal(themeColorScheme('synthwave'), 'dark');
  assert.equal(themeColorScheme('tropical'), 'light');
});

test('startup bootstrap honors every saved preference before the app paints', () => {
  const expectedNames = new Map(themeOptions.map(option => [option.id, option.name]));
  assert.equal(expectedNames.get('system'), 'System');
  for (const preference of ['dark', 'light', 'synthwave', 'tropical', 'system'] as const) {
    const forDarkOS = runStartup(preference, true);
    const forLightOS = runStartup(preference, false);
    assert.equal(forDarkOS.dataset.themePreference, preference);
    assert.equal(forLightOS.dataset.themePreference, preference);
    assert.equal(forDarkOS.dataset.theme, resolveTheme(preference, true));
    assert.equal(forLightOS.dataset.theme, resolveTheme(preference, false));
    assert.equal(forDarkOS.style.colorScheme, themeColorScheme(resolveTheme(preference, true)));
    assert.equal(forLightOS.style.colorScheme, themeColorScheme(resolveTheme(preference, false)));
  }
});

test('startup bootstrap falls back to dark for corrupt or unavailable storage', () => {
  for (const result of [runStartup('broken-preference', false), runStartup(null, true, true)]) {
    assert.equal(result.dataset.theme, 'dark');
    assert.equal(result.dataset.themePreference, 'dark');
    assert.equal(result.style.colorScheme, 'dark');
  }
});
