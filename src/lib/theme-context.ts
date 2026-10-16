import { createContext, useContext } from 'react';
import type { ThemeId, ThemePreference } from './theme';
export const ThemeContext = createContext<{
  preference: ThemePreference; theme: ThemeId; systemTheme: ThemeId; storageAvailable: boolean;
  setPreference: (value: ThemePreference) => void;
  settingsOpen: boolean; openSettings: () => void; closeSettings: () => void;
} | null>(null);
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('Theme controls require ThemeProvider.');
  return context;
}
