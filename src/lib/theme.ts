export const THEME_STORAGE_KEY = 'fitai_theme';
export const themeIds = ['dark', 'light', 'synthwave', 'tropical'] as const;
export type ThemeId = typeof themeIds[number];
export type ThemePreference = ThemeId | 'system';
export const themeOptions: Array<{ id: ThemePreference; name: string; description: string }> = [
  { id: 'dark', name: 'Dark', description: 'Forest shadows and a fresh lime accent.' },
  { id: 'light', name: 'Light', description: 'Soft daylight, clean surfaces, clear focus.' },
  { id: 'synthwave', name: 'Synthwave', description: 'Midnight violet, electric cyan, neon pink.' },
  { id: 'tropical', name: 'Tropical Ambiance', description: 'Warm sand, lush greens, a touch of coral.' },
  { id: 'system', name: 'System', description: 'Follow your device’s light or dark appearance.' },
];
export function parseThemePreference(value: unknown): ThemePreference {
  return themeOptions.some(option => option.id === value) ? value as ThemePreference : 'dark';
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ThemeId {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
export function themeColorScheme(theme: ThemeId): 'dark' | 'light' {
  return theme === 'light' || theme === 'tropical' ? 'light' : 'dark';
}
