"""Dialog keyboard and small viewport smoke checks for the local sample app.

Start `npm run dev`, then run `python tests/dialog-smoke.py`. Uses only the sample
workspace and browser-local state.
"""
import os
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000')
CHROMIUM = os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium')


def active_aria_label(page):
    return page.evaluate("document.activeElement?.getAttribute('aria-label')")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, headless=True,
                                   args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 320, 'height': 568}, reduced_motion='reduce')
        page.goto(BASE_URL, wait_until='domcontentloaded')
        page.get_by_role('button', name='Explore sample workspace').click()
        page.get_by_role('heading', name='Your workouts', exact=True).wait_for()

        # Exercise selector and its nested filter: Escape should close one layer
        # and return focus to the filter trigger inside the still-open selector.
        page.get_by_role('button', name='Workouts', exact=True).click()
        page.get_by_role('button', name='Create routine').click()
        page.get_by_role('button', name='Add Exercises').click()
        selector = page.get_by_role('dialog', name='Exercises')
        expect(selector).to_be_visible()
        close_selector = page.get_by_role('button', name='Close exercise selector')
        expect(close_selector).to_be_focused()
        search = page.get_by_role('textbox', name='Search exercises')
        search_box = search.bounding_box()
        assert search_box and search_box['x'] >= 0 and search_box['x'] + search_box['width'] <= 320, search_box
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Selector overflows at 320px'

        equipment_filter = page.get_by_role('button', name='Filter by equipment: All Equipment')
        equipment_filter.click()
        filter_dialog = page.get_by_role('dialog', name='Select Equipment')
        expect(filter_dialog).to_be_visible()
        page.keyboard.press('Escape')
        expect(filter_dialog).to_have_count(0)
        expect(selector).to_be_visible()
        expect(equipment_filter).to_be_focused()

        # Verify both ends of the selector focus loop.
        selector_buttons = selector.locator('button:not([disabled])')
        last_button = selector_buttons.last
        first_button = selector_buttons.first
        last_button.focus()
        page.keyboard.press('Tab')
        expect(first_button).to_be_focused()
        page.keyboard.press('Shift+Tab')
        expect(last_button).to_be_focused()

        # Custom exercise is another nested dialog; Escape must preserve its parent.
        page.get_by_role('button', name='Add custom exercise').click()
        custom = page.get_by_role('dialog', name='New Exercise')
        expect(custom).to_be_visible()
        page.keyboard.press('Escape')
        expect(custom).to_have_count(0)
        expect(selector).to_be_visible()
        page.keyboard.press('Escape')
        expect(selector).to_have_count(0)
        expect(page.get_by_role('heading', name='Edit Routine', exact=True)).to_be_visible()
        page.get_by_role('button', name='Cancel', exact=True).click()

        # Calendar Escape returns to Profile. Its focus loop also works at 320px.
        page.get_by_role('button', name='Profile', exact=True).click()
        calendar_trigger = page.get_by_role('button', name='Open workout calendar')
        calendar_trigger.click()
        calendar = page.get_by_role('dialog', name='Workout calendar')
        expect(calendar).to_be_visible()
        box = calendar.bounding_box()
        assert box and box['x'] >= 0 and box['x'] + box['width'] <= 320 and box['height'] <= 568, box
        controls = calendar.locator('button:not([disabled])')
        last_control, first_control = controls.last, controls.first
        last_control.focus()
        page.keyboard.press('Tab')
        expect(first_control).to_be_focused()
        page.keyboard.press('Shift+Tab')
        expect(last_control).to_be_focused()
        page.keyboard.press('Escape')
        expect(calendar).to_have_count(0)
        expect(calendar_trigger).to_be_focused()
        browser.close()
        print('Dialog nesting, Escape, focus restoration/traps, and 320px geometry passed')


if __name__ == '__main__':
    main()
