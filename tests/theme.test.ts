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
  assert.equal(themeColorScheme('porcelain'), 'light');
  assert.equal(themeColorScheme('graphite'), 'dark');
  assert.equal(themeColorScheme('slate'), 'dark');
});

test('startup bootstrap honors every saved preference before the app paints', () => {
  const expectedNames = new Map(themeOptions.map(option => [option.id, option.name]));
  assert.equal(expectedNames.get('system'), 'System');
  for (const { id: preference } of themeOptions) {
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

function cssPalette(id: string) {
  const css = readFileSync(fileURLToPath(new URL('../src/styles/themes.css', import.meta.url)), 'utf8');
  const block = css.match(new RegExp(`\\[data-theme="${id}"\\][^{]*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `Missing palette ${id}`);
  return Object.fromEntries([...block.matchAll(/(--color-[\w-]+):\s*#([\da-f]{6});/gi)].map(([, name, hex]) =>
    [name, [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))]));
}
function colorContrast(first: number[], second: number[]) {
  const luminance = (rgb: number[]) => rgb.map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('Graphite and Porcelain remain grayscale across every semantic color including status colors', () => {
  for (const id of ['graphite', 'porcelain']) {
    const colors = cssPalette(id);
    assert.deepEqual(Object.keys(colors).sort(), Object.keys(cssPalette('dark')).sort(), 'A monochrome theme must override every palette color');
    for (const [name, rgb] of Object.entries(colors)) {
      assert.equal(rgb[0], rgb[1], `${id} ${name} must be neutral gray`);
      assert.equal(rgb[1], rgb[2], `${id} ${name} must be neutral gray`);
    }
  }
});

test('Slate stays in one blue-gray hue family across the whole palette', () => {
  const colors = cssPalette('slate');
  assert.deepEqual(Object.keys(colors).sort(), Object.keys(cssPalette('dark')).sort());
  for (const [name, [r, g, b]] of Object.entries(colors)) {
    assert.ok(b > g && g > r, `Slate ${name} must stay blue-gray`);
    const hue = 60 * (4 + (r - g) / (b - r));
    assert.ok(hue >= 200 && hue <= 215, `Slate ${name} drifted out of its hue family`);
  }
});

test('monochrome foregrounds and action labels retain readable contrast on their surfaces', () => {
  for (const id of ['graphite', 'porcelain', 'slate']) {
    const colors = cssPalette(id);
    for (const text of ['--color-fg', '--color-muted', '--color-subtle']) {
      for (const surface of ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-hover']) {
        assert.ok(colorContrast(colors[text], colors[surface]) >= 4.5, `${id}: ${text} on ${surface} needs 4.5:1 contrast`);
      }
    }
    assert.ok(colorContrast(colors['--color-accent'], colors['--color-on-accent']) >= 4.5, `${id}: action labels need 4.5:1 contrast`);
  }
});
