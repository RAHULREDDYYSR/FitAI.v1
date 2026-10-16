import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, Sun, Moon, Waves, Sparkles, Monitor, X, Check } from 'lucide-react';
import { useTheme } from '../lib/theme-context';
import { themeOptions } from '../lib/theme';
import { useDialog } from '../lib/use-dialog';

export function SettingsButton({ showLabel = false }: { showLabel?: boolean }) {
  const { openSettings } = useTheme();
  return <button type="button" onClick={openSettings} aria-label={showLabel ? 'Appearance settings' : 'Open settings'} title="Settings"
    className={showLabel ? 'secondary-button' : 'icon-button settings-trigger'}>
    <SettingsIcon className="w-5 h-5" />{showLabel && <span>Appearance settings</span>}
  </button>;
}
export function SettingsDialog() {
  const { preference, systemTheme, setPreference, storageAvailable, settingsOpen, closeSettings } = useTheme();
  // Restore the app before useDialog restores focus to the opening control.
  useEffect(() => {
    if (!settingsOpen) return;
    const app = document.getElementById('root');
    const previousInert = app?.inert;
    const overflow = document.body.style.overflow;
    if (app) app.inert = true;
    document.body.style.overflow = 'hidden';
    const onBack = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      closeSettings();
      window.history.pushState({ app: true }, '');
    };
    window.addEventListener('popstate', onBack, true);
    return () => {
      if (app) app.inert = previousInert || false;
      document.body.style.overflow = overflow;
      window.removeEventListener('popstate', onBack, true);
    };
  }, [settingsOpen]);
  const dialog = useDialog<HTMLElement>(closeSettings, settingsOpen);
  if (!settingsOpen) return null;
  const icons = { dark: Moon, light: Sun, synthwave: Sparkles, tropical: Waves, system: Monitor };
  return createPortal(<div className="settings-backdrop" onClick={event => { if (event.target === event.currentTarget) closeSettings(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialog} className="settings-dialog">
      <header className="settings-header"><div><p className="eyebrow text-accent">Make it yours</p><h2 id="settings-title">Settings</h2></div>
        <button type="button" onClick={closeSettings} aria-label="Close settings" className="icon-button"><X className="w-5 h-5" /></button>
      </header>
      <div className="settings-content">
        <fieldset className="theme-fieldset"><legend>Theme</legend><p id="theme-description" className="theme-description">Choose a mood for your whole workspace.</p>
          <div className="theme-options" aria-describedby="theme-description">
            {themeOptions.map(option => {
              const Icon = icons[option.id];
              return <label key={option.id} className="theme-option" data-selected={preference === option.id}>
                <input type="radio" name="theme" value={option.id} aria-label={option.name} checked={preference === option.id} onChange={() => setPreference(option.id)} />
                <div className="theme-preview" data-preview-theme={option.id === 'system' ? systemTheme : option.id} aria-hidden="true">
                  <span className="theme-preview-sidebar"><Icon className="w-4 h-4" /><i /><i /><i /></span>
                  <span className="theme-preview-workspace"><i /><span /><span /><b /></span>
                </div>
                <span className="theme-option-heading"><span>{option.name}</span>{preference === option.id && <Check className="w-4 h-4 text-accent" aria-hidden="true" />}</span>
                <span className="theme-option-description">{option.description}</span>
              </label>;
            })}
          </div>
        </fieldset>
        <p className="theme-save-status" role="status">{storageAvailable ? 'Applies everywhere. Your choice is saved on this device.' : 'Theme applied for this session. Your browser could not save the preference.'}</p>
      </div>
    </section>
  </div>, document.body);
}
