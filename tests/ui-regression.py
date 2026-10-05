"""Manual workflow and responsive regressions for the local sample workspace.

Start the app with `npm run dev`, then run `python tests/ui-regression.py`.
All changes stay in the sample workspace's localStorage; no account, API key,
model call, or remote write is used.
"""
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000')
CHROMIUM = os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium')
VIEWPORTS = [(320, 568), (360, 800), (390, 844), (768, 1024), (1366, 768), (1920, 1080)]
STORAGE_KEY = 'fitai_sample_workspace_v1'
ARTIFACTS = Path(__file__).parent / 'artifacts' / 'tmp'


def workspace(page):
    return page.evaluate(f"JSON.parse(localStorage.getItem('{STORAGE_KEY}'))")


def activate_sample(page, touch=False):
    page.goto(BASE_URL, wait_until='domcontentloaded')
    button = page.get_by_role('button', name='Explore sample workspace')
    expect(button).to_be_visible()
    (button.tap if touch else button.click)()
    expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()


def assert_no_horizontal_overflow(page, label):
    metrics = page.evaluate("({width: innerWidth, scroll: document.documentElement.scrollWidth})")
    assert metrics['scroll'] <= metrics['width'], f'{label}: horizontal overflow {metrics}'


def routine_workflow(page, touch=False, mobile_screenshots=False):
    activate = lambda locator: (locator.tap if touch else locator.click)()
    original_workspace = workspace(page)
    original_count = len(original_workspace['routines'])

    # Existing editor data must be isolated until Save. This catches nested
    # array aliasing when a user changes a set and then cancels.
    first_routine = original_workspace['routines'][0]
    activate(page.get_by_role('button', name=f"Edit {first_routine['name']}", exact=True))
    page.locator('input[type="number"]').first.fill('999')
    activate(page.get_by_role('button', name='Add Base Set').first)
    activate(page.get_by_role('button', name='Cancel', exact=True))
    assert workspace(page)['routines'][0] == first_routine, 'Canceled routine edits changed persisted data'
    first_card = page.get_by_role('button', name=f"Edit {first_routine['name']}", exact=True).locator('xpath=ancestor::div[contains(@class,"routine-card")]')
    set_count = sum(len(exercise['sets']) for exercise in first_routine['exercises'])
    assert f"{len(first_routine['exercises'])} exercises" in first_card.inner_text()
    assert f"{set_count} sets" in first_card.inner_text(), 'Canceled set addition leaked into the routine library view'

    activate(page.get_by_role('button', name='Create routine'))
    expect(page.get_by_role('heading', name='Edit Routine', exact=True)).to_be_visible()

    page.get_by_placeholder('Routine Name').fill('UI Regression Routine')
    page.get_by_placeholder('Description (Optional)').fill('Created by the local UI regression.')
    activate(page.get_by_role('button', name='Add Exercises'))
    expect(page.get_by_role('heading', name='Exercises', exact=True)).to_be_visible()
    search = page.get_by_placeholder('Search exercise')
    expect(search).to_be_visible()
    search.fill('bench press (barbell)')
    exercise = page.get_by_role('button', name=re.compile(r'^Bench Press \(Barbell\)'))
    expect(exercise).to_be_visible()
    activate(exercise)
    expect(page.get_by_role('heading', name='Bench Press (Barbell)', exact=True)).to_be_visible()

    # Verify keyboard access to the now-enabled Save control.
    page.get_by_role('button', name='Cancel', exact=True).focus()
    page.keyboard.press('Tab')
    focused = page.evaluate("document.activeElement?.textContent?.trim()")
    assert focused == 'Save', f'Routine editor keyboard order skipped Save: {focused!r}'

    # The routine editor contains weight and rep inputs for each set.
    numbers = page.locator('input[type="number"]')
    expect(numbers).to_have_count(2)
    numbers.nth(0).fill('42.5')
    numbers.nth(1).fill('8')
    activate(page.get_by_role('button', name='Add Base Set'))
    numbers = page.locator('input[type="number"]')
    expect(numbers).to_have_count(4)
    numbers.nth(2).fill('45')
    numbers.nth(3).fill('6')
    activate(page.get_by_role('button', name='Add Exercises'))
    squat_search = page.get_by_placeholder('Search exercise')
    squat_search.fill('goblet squat')
    activate(page.get_by_role('button', name=re.compile(r'^Goblet Squat')))
    expect(page.get_by_role('heading', name='Goblet Squat', exact=True)).to_be_visible()
    numbers = page.locator('input[type="number"]')
    expect(numbers).to_have_count(6)
    numbers.nth(4).fill('20')
    numbers.nth(5).fill('10')
    activate(page.get_by_role('button', name='Save', exact=True))

    card = page.get_by_role('button', name='Edit UI Regression Routine', exact=True)
    expect(card).to_be_visible()
    created = next(r for r in workspace(page)['routines'] if r['name'] == 'UI Regression Routine')
    assert [exercise['name'] for exercise in created['exercises']] == ['Bench Press (Barbell)', 'Goblet Squat']
    assert [(s['weight'], s['reps']) for s in created['exercises'][0]['sets']] == [(42.5, 8), (45, 6)]
    assert [(s['weight'], s['reps']) for s in created['exercises'][1]['sets']] == [(20, 10)]
    assert len(workspace(page)['routines']) == original_count + 1

    # Cancel an edit and dismiss a native delete dialog; each operation must
    # leave the saved routine unchanged and restore focus to its action button.
    activate(card)
    page.get_by_placeholder('Routine Name').fill('Unsaved Name')
    activate(page.get_by_role('button', name='Cancel', exact=True))
    expect(page.get_by_role('button', name='Edit UI Regression Routine', exact=True)).to_be_visible()
    assert next(r for r in workspace(page)['routines'] if r['id'] == created['id'])['name'] == 'UI Regression Routine'

    delete = page.get_by_role('button', name='Delete UI Regression Routine', exact=True)
    delete.focus()
    dismissed_dialogs = []
    def dismiss_delete_dialog(dialog):
        dismissed_dialogs.append(dialog.message)
        dialog.dismiss()
    page.once('dialog', dismiss_delete_dialog)
    activate(delete)
    assert dismissed_dialogs and 'Delete this routine' in dismissed_dialogs[0]
    assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == 'Delete UI Regression Routine'
    assert any(r['id'] == created['id'] for r in workspace(page)['routines'])

    # Start and save a real sample workout. Invalid finish must preserve work.
    if mobile_screenshots:
        page.screenshot(path='/tmp/fitai-mobile.png')
    activate(page.get_by_role('button', name='Start UI Regression Routine', exact=True))
    activate(page.get_by_role('button', name='Finish', exact=True))
    expect(page.get_by_role('alert')).to_contain_text('Complete at least one set')
    assert workspace(page)['workouts'][0]['name'] != 'UI Regression Routine', 'Invalid finish wrote a workout'

    # Start a timer on the second exercise, reorder it, remove the other
    # exercise, and make sure elapsed time remains attached to the same set.
    timer = page.get_by_role('button', name='Start Goblet Squat set 1 timer', exact=True)
    activate(timer)
    timed_input = page.get_by_role('textbox', name='Goblet Squat set 1 time (minutes:seconds)')
    expect(timed_input).not_to_have_value('', timeout=5000)
    activate(page.get_by_role('button', name='Move Goblet Squat up', exact=True))
    activate(page.get_by_role('button', name='Remove Bench Press (Barbell)', exact=True))
    expect(timed_input).not_to_have_value('')
    if mobile_screenshots:
        page.screenshot(path='/tmp/fitai-mobile-logger.png', full_page=True)
    page.reload(wait_until='domcontentloaded')
    resume = page.get_by_role('button', name=re.compile(r'^Resume workout'))
    expect(resume).to_be_visible()
    resume_box = resume.bounding_box()
    viewport_width = page.evaluate('innerWidth')
    viewport_height = page.evaluate('innerHeight')
    assert resume_box and resume_box['x'] >= 0 and resume_box['x'] + resume_box['width'] <= viewport_width \
        and resume_box['y'] >= 0 and resume_box['y'] + resume_box['height'] <= viewport_height, \
        f'Resume workout control clipped at {viewport_width}px: {resume_box}'
    activate(resume)
    timed_input = page.get_by_role('textbox', name='Goblet Squat set 1 time (minutes:seconds)')
    expect(timed_input).not_to_have_value('')
    activate(page.get_by_role('button', name='Complete Goblet Squat set 1', exact=True))
    expect(page.get_by_role('button', name='Undo Goblet Squat set 1', exact=True)).to_be_visible()
    logged_before = len(workspace(page)['workouts'])
    activate(page.get_by_role('button', name='Finish', exact=True))
    expect(page.get_by_role('heading', name='Crushed It.', exact=True)).to_be_visible()
    saved_workout = workspace(page)['workouts'][0]
    assert saved_workout['name'] == 'UI Regression Routine'
    assert len(workspace(page)['workouts']) == logged_before + 1
    assert [exercise['name'] for exercise in saved_workout['exercises']] == ['Goblet Squat']
    assert saved_workout['exercises'][0]['sets'][0]['completed'] is True
    assert saved_workout['exercises'][0]['sets'][0]['weight'] == 20
    assert saved_workout['exercises'][0]['sets'][0]['timeTaken'] >= 1
    activate(page.get_by_role('button', name=re.compile(r'View progress|Back to Dashboard', re.I)))
    expect(page.get_by_role('heading', name='Progress', exact=True)).to_be_visible()
    activate(page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Workouts', exact=True))
    expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()

    # Delete the created routine after its workout has been logged; canceling
    # above already proved the dialog's preservation path.
    page.once('dialog', lambda dialog: dialog.accept())
    activate(page.get_by_role('button', name='Delete UI Regression Routine', exact=True))
    expect(page.get_by_role('button', name='Edit UI Regression Routine', exact=True)).to_have_count(0)
    assert not any(r['id'] == created['id'] for r in workspace(page)['routines'])
    assert workspace(page)['workouts'][0]['name'] == 'UI Regression Routine'


def profile_workflow(page, touch=False):
    activate = lambda locator: (locator.tap if touch else locator.click)()
    activate(page.get_by_role('button', name='Profile', exact=True))
    expect(page.get_by_role('heading', name='Alex', exact=True)).to_be_visible()
    original_profile = workspace(page)['profile']
    activate(page.get_by_role('button', name=re.compile(r'^Edit(?: Profile)?$', re.I)))
    short_goal = page.get_by_placeholder('e.g. Gain 5kg lean muscle by August')
    long_goal = page.get_by_placeholder("e.g. Compete in Men's Physique by 2026")
    aim = page.get_by_placeholder('Describe what you want to achieve, your motivation, and your ultimate vision...')
    short_goal.fill('This edit should be canceled')
    activate(page.get_by_role('button', name=re.compile(r'Cancel Profile Edit', re.I)))
    assert workspace(page)['profile'] == original_profile, 'Canceled profile edits changed saved values'
    assert page.get_by_text(original_profile['shortTermGoal'], exact=True).is_visible()

    activate(page.get_by_role('button', name=re.compile(r'^Edit(?: Profile)?$', re.I)))
    short_goal = page.get_by_placeholder('e.g. Gain 5kg lean muscle by August')
    long_goal = page.get_by_placeholder("e.g. Compete in Men's Physique by 2026")
    aim = page.get_by_placeholder('Describe what you want to achieve, your motivation, and your ultimate vision...')
    age = page.get_by_label('Age')
    short_goal.fill('Draft preserved after validation error')
    age.fill('12')
    activate(page.get_by_role('button', name=re.compile(r'^Save(?: Profile)?$', re.I)))
    expect(page.get_by_role('alert')).to_contain_text(re.compile(r'age|13|valid', re.I))
    assert workspace(page)['profile'] == original_profile, 'Invalid profile data was persisted'
    assert short_goal.input_value() == 'Draft preserved after validation error', 'Validation error discarded the profile draft'

    short_goal = page.get_by_placeholder('e.g. Gain 5kg lean muscle by August')
    long_goal = page.get_by_placeholder("e.g. Compete in Men's Physique by 2026")
    aim = page.get_by_placeholder('Describe what you want to achieve, your motivation, and your ultimate vision...')
    age = page.get_by_label('Age')
    short_goal.fill('Train four days each week')
    long_goal.fill('Complete a half marathon next spring')
    aim.fill('Build consistency and enjoy training outdoors.')
    age.fill('31')
    activate(page.get_by_role('button', name=re.compile(r'^Save(?: Profile)?$', re.I)))
    stored = workspace(page)['profile']
    assert stored['shortTermGoal'] == 'Train four days each week'
    assert stored['longTermGoal'] == 'Complete a half marathon next spring'
    assert stored['aim'] == 'Build consistency and enjoy training outdoors.'
    assert stored['age'] == 31
    page.reload(wait_until='domcontentloaded')
    expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
    activate(page.get_by_role('button', name='Profile', exact=True))
    expect(page.get_by_text('Train four days each week', exact=True)).to_be_visible()
    assert workspace(page)['profile']['age'] == 31


def responsive_workflow(page, widths=VIEWPORTS, touch=False):
    activate = lambda locator: (locator.tap if touch else locator.click)()
    for width, height in widths:
        page.set_viewport_size({'width': width, 'height': height})
        expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
        assert_no_horizontal_overflow(page, f'{width}x{height} routines')
        nav = page.get_by_role('navigation', name='Main navigation')
        expect(nav).to_be_visible()
        nav_box = nav.bounding_box()
        assert nav_box and nav_box['width'] > 0 and nav_box['height'] > 0
        if width < 760:
            activate(page.get_by_role('button', name='Profile', exact=True))
            expect(page.get_by_role('heading', name='Alex', exact=True)).to_be_visible()
            sign_out = page.get_by_role('button', name='Sign Out', exact=True)
            sign_out.scroll_into_view_if_needed()
            sign_box = sign_out.bounding_box()
            profile_nav_box = nav.bounding_box()
            assert sign_box and profile_nav_box and sign_box['y'] + sign_box['height'] <= profile_nav_box['y'] + 1, \
                f'{width}px bottom navigation covers the final profile control: control={sign_box}, nav={profile_nav_box}'
            activate(page.get_by_role('button', name='Workouts', exact=True))

            create = page.get_by_role('button', name='Create routine')
            create.scroll_into_view_if_needed()
            box = create.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= width, f'{width}px create button clipped: {box}'
            assert nav_box['y'] >= height - nav_box['height'] - 1, f'{width}px mobile navigation is not at viewport bottom: {nav_box}'
            if width == 320:
                activate(create)
                activate(page.get_by_role('button', name='Add Exercises'))
                search = page.get_by_placeholder('Search exercise')
                expect(page.get_by_role('heading', name='Exercises', exact=True)).to_be_visible()
                search_box = search.bounding_box()
                assert search_box and search_box['x'] >= 0 and search_box['x'] + search_box['width'] <= width, \
                    f'320px exercise search clipped: {search_box}'
                assert_no_horizontal_overflow(page, '320x568 exercise picker')
                close_selector = page.get_by_role('button', name='Close exercise selector')
                if close_selector.count():
                    activate(close_selector)
                else:
                    activate(page.get_by_role('banner').get_by_role('button').first)
                activate(page.get_by_role('button', name='Cancel', exact=True))
                expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
                activate(page.get_by_role('button', name='Start Upper Body', exact=True))
                page.evaluate('history.back()')
                resume = page.get_by_role('button', name='Resume workout', exact=True)
                expect(resume).to_be_visible()
                resume_box = resume.bounding_box()
                assert resume_box and resume_box['x'] >= 0 and resume_box['x'] + resume_box['width'] <= width \
                    and resume_box['y'] >= 0 and resume_box['y'] + resume_box['height'] <= height, \
                    f'Resume workout control clipped at {width}px: {resume_box}'
                activate(resume)
                page.once('dialog', lambda dialog: dialog.dismiss())
                activate(page.get_by_role('button', name='Discard', exact=True))
                assert page.get_by_role('button', name='Finish', exact=True).is_visible(), 'Dismissing discard lost the mobile workout'
                page.once('dialog', lambda dialog: dialog.accept())
                activate(page.get_by_role('button', name='Discard', exact=True))
                expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
        print(f'PASS responsive viewport {width}x{height}')


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    failure_image = ARTIFACTS / 'ui-regression-failure.png'
    failure_image.unlink(missing_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=CHROMIUM,
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage'],
        )
        page = browser.new_page(viewport={'width': 1366, 'height': 768}, reduced_motion='reduce')
        page.set_default_timeout(8000)
        page_errors = []
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        try:
            activate_sample(page)
            routine_workflow(page)
            profile_workflow(page)
            # Return to the routine dashboard for viewport/layout assertions.
            page.get_by_role('button', name='Workouts', exact=True).click()
            expect(page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
            responsive_workflow(page)
            assert_no_horizontal_overflow(page, 'final workspace')
            assert not page_errors, f'Browser runtime errors: {page_errors}'
            print('PASS sample routine create/edit/cancel/delete, exercise search, set logging/save, profile edit/reload, keyboard order, delete dialog focus, and six viewport checks')

            mobile_context = browser.new_context(
                viewport={'width': 390, 'height': 844},
                is_mobile=True,
                has_touch=True,
                reduced_motion='reduce',
            )
            try:
                mobile_page = mobile_context.new_page()
                mobile_page.set_default_timeout(8000)
                mobile_errors = []
                mobile_page.on('pageerror', lambda error: mobile_errors.append(str(error)))
                assert mobile_page.evaluate('navigator.maxTouchPoints > 0'), 'Mobile context did not enable touch input'
                assert mobile_page.evaluate("matchMedia('(pointer: coarse)').matches"), 'Mobile context did not expose a coarse pointer'
                activate_sample(mobile_page, touch=True)
                routine_workflow(mobile_page, touch=True, mobile_screenshots=True)
                profile_workflow(mobile_page, touch=True)
                mobile_page.get_by_role('navigation', name='Main navigation').get_by_role('button', name='Workouts', exact=True).tap()
                expect(mobile_page.get_by_role('heading', name='Your workouts', exact=True)).to_be_visible()
                responsive_workflow(mobile_page, widths=[(320, 568), (360, 800), (390, 844)], touch=True)
                assert not mobile_errors, f'Mobile browser runtime errors: {mobile_errors}'
                print('PASS touch-enabled mobile workflow and responsive checks at 320×568, 360×800, and 390×844')
            finally:
                mobile_context.close()
        except Exception:
            try:
                page.screenshot(path=str(ARTIFACTS / 'ui-regression-failure.png'), full_page=True,
                                animations='disabled', timeout=3000)
            except Exception:
                pass
            raise
        finally:
            browser.close()


if __name__ == '__main__':
    main()
