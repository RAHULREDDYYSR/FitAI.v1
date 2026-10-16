"""Theme picker smoke/regression coverage for the local sample workspace.

Run with the app at http://127.0.0.1:3000:
    python tests/theme-smoke.py

The browser uses only the built-in sample workspace; it makes no signed-in
account writes or paid model requests and needs no API credentials. Screenshots
are written under the ignored tests/artifacts/themes directory.
"""
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


BASE_URL = os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000')
CHROMIUM = os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium')
ARTIFACTS = Path(__file__).parent / 'artifacts' / 'themes'
THEMES = {
    'Dark': 'dark',
    'Light': 'light',
    'Graphite': 'graphite',
    'Porcelain': 'porcelain',
    'Slate': 'slate',
    'Synthwave': 'synthwave',
    'Tropical Ambiance': 'tropical',
    'System': 'system',
}
PREFERENCES = {
    'Dark': 'dark',
    'Light': 'light',
    'Graphite': 'graphite',
    'Porcelain': 'porcelain',
    'Slate': 'slate',
    'Synthwave': 'synthwave',
    'Tropical Ambiance': 'tropical',
    'System': 'system',
}
PALETTE = ('--color-bg', '--color-app-bg', '--color-surface', '--color-surface-raised', '--color-fg', '--color-muted',
           '--color-accent', '--color-on-accent', '--color-border', '--color-secondary')


def rgb(value):
    """Parse browser-resolved rgb()/rgba() colors."""
    match = re.fullmatch(r'rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)', value.strip())
    assert match, f'Expected a resolved RGB color, got {value!r}'
    parts = [float(match.group(i)) / 255 for i in (1, 2, 3)]
    alpha = float(match.group(4)) if match.group(4) is not None else 1.0
    return (*parts, alpha)


def luminance(color):
    channels = []
    for channel in color[:3]:
        channels.append(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def open_settings(page):
    button = page.get_by_role('button', name='Open settings', exact=True)
    expect(button).to_have_count(1)
    expect(button).to_be_visible()
    button.click()
    dialog = page.get_by_role('dialog', name='Settings')
    expect(dialog).to_be_visible()
    group = dialog.get_by_role('group', name='Theme')
    expect(group).to_be_visible()
    assert_background_matches(page, '[role="dialog"][aria-labelledby="settings-title"]', '--color-surface', 'settings dialog')
    return button, dialog, group


def pick_theme(page, choice, storage_available=True):
    _, dialog, group = open_settings(page)
    radio = group.get_by_role('radio', name=choice, exact=True)
    expect(radio).to_be_visible()
    expected = PREFERENCES[choice]
    if storage_available and radio.is_checked() and page.evaluate("localStorage.getItem('fitai_theme')") != expected:
        other = next(name for name in THEMES if name != choice)
        group.get_by_role('radio', name=other, exact=True).check()
    radio.check()
    expect(radio).to_be_checked()
    effective = page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'") if choice == 'System' else THEMES[choice]
    expect(page.locator('html')).to_have_attribute('data-theme', effective)
    expect(page.locator('html')).to_have_attribute('data-theme-preference', expected)
    if storage_available:
        page.wait_for_function("expected => localStorage.getItem('fitai_theme') === expected", arg=expected)
    return dialog


def palette(page, label):
    values = page.evaluate("""() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const names = ['--color-bg','--color-app-bg','--color-surface','--color-surface-raised','--color-fg','--color-muted',
        '--color-accent','--color-on-accent','--color-border','--color-secondary'];
      const resolve = value => { const node = document.createElement('span'); node.style.color = value; document.body.appendChild(node); const color = getComputedStyle(node).color; node.remove(); return color; };
      return {root: Object.fromEntries(names.map(n => [n, resolve(root.getPropertyValue(n).trim())])),
        bodyBackground: body.backgroundColor, bodyColor: body.color,
        htmlBackground: root.backgroundColor};
    }""")
    for name in PALETTE:
        assert values['root'][name], f'{label}: missing theme token {name}'
    # The central page surfaces must resolve from the active palette. This
    # catches old hard-coded page backgrounds that ignore theme selection.
    bg = rgb(page.evaluate("getComputedStyle(document.body).backgroundColor"))
    fg = rgb(page.evaluate("getComputedStyle(document.body).color"))
    assert contrast(fg, bg) >= 4.5, f'{label}: body text contrast {contrast(fg,bg):.2f}:1'
    tokens = {name: rgb(value) for name, value in values['root'].items()}
    assert contrast(tokens['--color-fg'], tokens['--color-bg']) >= 4.5, f'{label}: foreground/background contrast below 4.5:1'
    assert contrast(tokens['--color-on-accent'], tokens['--color-accent']) >= 4.5, f'{label}: accent contrast below 4.5:1'
    return values


def screenshot(page, theme, view):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f'{theme.lower().replace(" ", "-")}-{view}.png'), full_page=True)


def assert_background_matches(page, selector, token, label):
    locator = page.locator(selector).first
    expect(locator).to_be_visible()
    actual = rgb(locator.evaluate("node => getComputedStyle(node).backgroundColor"))
    expected = rgb(page.evaluate("token => { const n=document.createElement('span'); n.style.color=getComputedStyle(document.documentElement).getPropertyValue(token); document.body.append(n); const c=getComputedStyle(n).color; n.remove(); return c; }", token))
    assert all(abs(a - b) < 0.005 for a, b in zip(actual, expected)), \
        f'{label}: {selector} background {actual} does not match {token} {expected}'


def assert_theme(page, choice, view):
    expected = page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'") if choice == 'System' else THEMES[choice]
    expect(page.locator('html')).to_have_attribute('data-theme', expected)
    values = palette(page, f'{choice} / {view}')
    if page.locator('.app-shell').count():
        assert_background_matches(page, '.app-shell', '--color-app-bg', f'{choice} / {view}')
    if page.locator('.editor-screen').count():
        assert_background_matches(page, '.editor-screen', '--color-bg', f'{choice} / {view}')
    if page.locator('[aria-labelledby="exercise-selector-title"]').count():
        assert_background_matches(page, '[aria-labelledby="exercise-selector-title"]', '--color-bg', f'{choice} / {view}')
    if page.locator('[aria-labelledby="workout-calendar-title"]').count():
        assert_background_matches(page, '[aria-labelledby="workout-calendar-title"]', '--color-surface', f'{choice} / {view}')
    if view == 'progress':
        assert_background_matches(page, '.bg-surface', '--color-surface', f'{choice} / {view}')
    screenshot(page, choice, view)
    return values


def assert_theme_family(choice, values):
    colors = {name: rgb(value) for name, value in values['root'].items()}
    if choice in ('Graphite', 'Porcelain'):
        for name, color in colors.items():
            spread = max(color[:3]) - min(color[:3])
            assert spread <= 0.01, f'{choice}: {name} is not grayscale: {color}'
    if choice == 'Slate':
        for name, color in colors.items():
            red, green, blue = color[:3]
            assert red <= green + 0.01 <= blue + 0.02, f'Slate: {name} is not a cool gray: {color}'
            assert blue - red <= 0.30, f'Slate: {name} is too colorful for a cool gray palette: {color}'


def main():
    page_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROMIUM)
        context = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark')
        page = context.new_page()
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(BASE_URL, wait_until='domcontentloaded')

        # Settings remain available before and after entering the sample.
        _, login_dialog, login_group = open_settings(page)
        expect(login_group.get_by_role('radio')).to_have_count(len(THEMES))
        dark_radio = login_group.get_by_role('radio', name='Dark', exact=True)
        dark_radio.focus()
        page.keyboard.press('ArrowRight')
        expect(login_group.get_by_role('radio', name='Light', exact=True)).to_be_checked()
        expect(page.locator('html')).to_have_attribute('data-theme', 'light')
        close = login_dialog.get_by_role('button', name='Close settings', exact=True)
        close.focus()
        page.keyboard.press('Tab')
        expect(login_group.locator('input[type="radio"]:checked')).to_be_focused()
        page.keyboard.press('Tab')
        expect(close).to_be_focused()
        page.keyboard.press('Escape')
        expect(login_dialog).to_be_hidden()
        expect(page.get_by_role('button', name='Open settings', exact=True)).to_be_focused()

        page.get_by_role('button', name='Explore sample workspace').click()
        expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
        open_settings(page)
        page.get_by_role('dialog', name='Settings').get_by_role('button', name='Close settings', exact=True).click()

        # Every choice applies immediately, survives reload, and keeps the
        # settings control usable from representative app surfaces.
        observed_palettes = {}
        for choice in THEMES:
            dialog = pick_theme(page, choice)
            assert_theme_family(choice, palette(page, f'{choice} settings'))
            screenshot(page, choice, 'settings')
            dialog.get_by_role('button', name='Close settings', exact=True).click()
            values = assert_theme(page, choice, 'workouts')
            assert_theme_family(choice, values)
            if choice != 'System':
                observed_palettes[choice] = values['root']
            page.reload(wait_until='domcontentloaded')
            expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
            effective = page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'") if choice == 'System' else THEMES[choice]
            expect(page.locator('html')).to_have_attribute('data-theme', effective)
            assert_theme(page, choice, 'workouts-reload')

            nav = page.get_by_role('navigation', name='Main navigation')
            nav.get_by_role('button', name='Progress', exact=True).click()
            expect(page.get_by_role('heading', name='Progress', exact=True)).to_be_visible()
            assert_theme(page, choice, 'progress')
            chart = page.locator('.recharts-wrapper').first
            expect(chart).to_be_visible()
            chart_strokes = page.locator('.recharts-wrapper svg [stroke]').evaluate_all(
                "nodes => nodes.map(node => getComputedStyle(node).stroke).filter(value => value && value !== 'none')")
            assert chart_strokes, f'{choice}: progress chart has no themed strokes'
            expected_chart_colors = page.evaluate("""() => {
              const s = getComputedStyle(document.documentElement);
              return ['--color-muted','--color-border','--color-secondary','--color-accent']
                .map(key => { const n=document.createElement('span'); n.style.color=s.getPropertyValue(key); document.body.append(n); const v=getComputedStyle(n).color; n.remove(); return v; });
            }""")
            assert any(stroke in expected_chart_colors for stroke in chart_strokes), \
                f'{choice}: chart strokes do not use active theme colors: {chart_strokes}'
            nav.get_by_role('button', name='Coach', exact=True).click()
            expect(page.get_by_role('log', name='Coach conversation')).to_be_visible()
            assert_theme(page, choice, 'coach')
            nav.get_by_role('button', name='Workouts', exact=True).click()

            # Exercise picker is reached through the real routine editor.
            page.get_by_role('button', name='Create routine').click()
            expect(page.get_by_role('heading', name='Edit Routine', exact=True)).to_be_visible()
            page.get_by_placeholder('Routine Name').fill('Unsaved Theme Regression')
            assert_theme(page, choice, 'editor')
            _, editor_settings, _ = open_settings(page)
            editor_settings.get_by_role('button', name='Close settings', exact=True).click()
            page.get_by_role('button', name='Add Exercises').click()
            expect(page.get_by_role('heading', name='Exercises', exact=True)).to_be_visible()
            assert_theme(page, choice, 'exercise-selector')
            page.get_by_placeholder('Search exercise').fill('bench press (barbell)')
            page.get_by_role('button', name=re.compile(r'^Bench Press \(Barbell\)')).click()
            expect(page.get_by_role('heading', name='Bench Press (Barbell)', exact=True)).to_be_visible()
            other_choice = 'Light' if choice != 'Light' else 'Dark'
            for temporary_choice in (other_choice, choice):
                themed_dialog = pick_theme(page, temporary_choice)
                themed_dialog.get_by_role('button', name='Close settings', exact=True).click()
                expect(page.get_by_placeholder('Routine Name')).to_have_value('Unsaved Theme Regression')
                expect(page.get_by_role('heading', name='Bench Press (Barbell)', exact=True)).to_be_visible()
            page.keyboard.press('Escape')
            expect(page.get_by_role('heading', name='Edit Routine', exact=True)).to_be_visible()
            page.get_by_role('button', name='Cancel', exact=True).click()

            # Start a sample routine without completing or saving a workout.
            # This reaches the active logger while keeping its state ephemeral.
            start_buttons = page.get_by_role('button', name=re.compile(r'^Start .+'))
            expect(start_buttons.first).to_be_visible()
            start_buttons.first.click()
            expect(page.get_by_role('button', name='Finish', exact=True)).to_be_visible()
            weight_input = page.get_by_role('spinbutton').first
            weight_input.fill('47.5')
            timer_button = page.get_by_role('button', name=re.compile(r'^Start .+ set 1 timer$')).first
            timer_button.click()
            timer_input = page.get_by_role('textbox', name=re.compile(r' set 1 time \(minutes:seconds\)$')).first
            expect(timer_input).not_to_have_value('')
            assert_theme(page, choice, 'logger')
            for temporary_choice in (other_choice, choice):
                logger_settings = pick_theme(page, temporary_choice)
                logger_settings.get_by_role('button', name='Close settings', exact=True).click()
                expect(weight_input).to_have_value('47.5')
                expect(timer_input).not_to_have_value('')
            discard = page.get_by_role('button', name=re.compile(r'Discard|Cancel workout', re.I))
            if discard.count():
                page.once('dialog', lambda d: d.accept())
                discard.click()
            else:
                # If the logger exposes minimize instead of discard, return to
                # routines without saving and leave the sample data untouched.
                minimize = page.get_by_role('button', name=re.compile(r'Minimize|Back to workouts', re.I))
                expect(minimize).to_be_visible()
                minimize.click()
                page.get_by_role('button', name=re.compile(r'^Resume workout')).click()
                page.once('dialog', lambda d: d.accept())
                page.get_by_role('button', name=re.compile(r'Discard|Cancel workout', re.I)).click()

            # Calendar is a dialog opened from Profile and uses only sample data.
            nav.get_by_role('button', name='Profile', exact=True).click()
            page.get_by_role('button', name='Open workout calendar').click()
            expect(page.get_by_role('dialog', name=re.compile('Workout calendar'))).to_be_visible()
            assert_theme(page, choice, 'calendar')
            page.keyboard.press('Escape')
            nav.get_by_role('button', name='Workouts', exact=True).click()
            print(f'PASS {choice} theme workflow', flush=True)

        palette_signatures = {tuple(colors[name] for name in ('--color-bg', '--color-accent', '--color-secondary'))
                              for colors in observed_palettes.values()}
        assert len(palette_signatures) == len(THEMES) - 1, \
            f'Expected {len(THEMES) - 1} visually distinct palettes, got {palette_signatures}'

        # System follows prefers-color-scheme changes and storage events from
        # another same-origin tab. The System choice remains the stored choice.
        context.set_extra_http_headers({})
        page.emulate_media(color_scheme='light')
        pick_theme(page, 'System').get_by_role('button', name='Close settings', exact=True).click()
        expect(page.locator('html')).to_have_attribute('data-theme', 'light')
        page.emulate_media(color_scheme='dark')
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        expect(page.locator('html')).to_have_attribute('data-theme-preference', 'system')
        assert page.evaluate("localStorage.getItem('fitai_theme')") == 'system'

        second_tab = context.new_page()
        second_tab.goto(BASE_URL, wait_until='domcontentloaded')
        second_tab.evaluate("localStorage.setItem('fitai_theme', 'synthwave')")
        expect(page.locator('html')).to_have_attribute('data-theme-preference', 'synthwave')
        expect(page.locator('html')).to_have_attribute('data-theme', 'synthwave')
        second_tab.close()

        # A browser that blocks this preference key should still render and
        # allow an in-memory selection without an uncaught page error.
        blocked = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark')
        blocked.add_init_script("""(() => {
          const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
          Storage.prototype.getItem = function(k) { if (k === 'fitai_theme') throw new DOMException('blocked'); return get.call(this,k); };
          Storage.prototype.setItem = function(k,v) { if (k === 'fitai_theme') throw new DOMException('blocked'); return set.call(this,k,v); };
        })();""")
        blocked_page = blocked.new_page()
        blocked_errors = []
        blocked_page.on('pageerror', lambda error: blocked_errors.append(str(error)))
        blocked_page.goto(BASE_URL, wait_until='domcontentloaded')
        pick_theme(blocked_page, 'Light', storage_available=False).get_by_role('button', name='Close settings', exact=True).click()
        expect(blocked_page.locator('html')).to_have_attribute('data-theme', 'light')
        assert not blocked_errors, f'Theme selection failed with blocked storage: {blocked_errors}'
        blocked.close()

        for width, height in [(320, 568), (390, 844), (1366, 768)]:
            page.set_viewport_size({'width': width, 'height': height})
            _, dialog, _ = open_settings(page)
            box = dialog.bounding_box()
            assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width and box['y'] + box['height'] <= height, \
                f'Settings dialog clipped at {width}x{height}: {box}'
            dialog.get_by_role('button', name='Close settings', exact=True).click()

        assert not page_errors, f'Uncaught browser errors: {page_errors}'
        browser.close()
    print(f'PASS theme picker access, {len(THEMES)} preferences, {len(THEMES) - 1} distinct palettes, persistence, system mode, representative screens, palette contrast, and responsive settings dialog')


if __name__ == '__main__':
    main()
