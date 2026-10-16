import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ThemeContext } from '../lib/theme-context';
import { parseThemePreference, resolveTheme, themeColorScheme, THEME_STORAGE_KEY, type ThemePreference } from '../lib/theme';
import { SettingsDialog } from './Settings';

function savedPreference() {
  try { return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return parseThemePreference(document.documentElement.dataset.themePreference); }
}
function systemIsDark() {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState(savedPreference);
  const [systemDark, setSystemDark] = useState(systemIsDark);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = resolveTheme(preference, systemDark);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = themeColorScheme(theme);
    const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
    if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  }, [preference, theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setPreferenceState(parseThemePreference(event.newValue));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setPreference = useCallback((value: ThemePreference) => {
    const next = parseThemePreference(value);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
    setSystemDark(systemIsDark());
    setPreferenceState(next);
  }, []);
  return <ThemeContext.Provider value={{ preference, theme, systemTheme: resolveTheme('system', systemDark), storageAvailable, setPreference, settingsOpen,
    openSettings: () => setSettingsOpen(true), closeSettings: () => setSettingsOpen(false) }}>
    {children}
    <SettingsDialog />
  </ThemeContext.Provider>;
}
