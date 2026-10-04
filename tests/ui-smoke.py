"""Sample-workspace integration checks. Start npm run dev before running.

Uses the cloud machine's Python Playwright and Chromium, with no sign-in,
database writes, mocked AI output, or model credentials.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000')
CHROMIUM = os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium')


def workspace(page):
    return page.evaluate("JSON.parse(localStorage.getItem('fitai_sample_workspace_v1'))")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM, headless=True,
                                   args=['--no-sandbox', '--disable-dev-shm-usage'])
        for width, height in [(1440, 960), (390, 844)]:
            page = browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE_URL, wait_until='domcontentloaded')
            page.get_by_role('button', name='Explore sample workspace').wait_for()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Landing overflow'
            page.get_by_role('button', name='Explore sample workspace').click()
            page.get_by_role('heading', name='Your workouts', exact=True).wait_for()
            original = workspace(page)['routines'][0]
            page.get_by_role('button', name='Coach', exact=True).click()
            page.get_by_role('button', name='List my routines', exact=True).click()
            page.get_by_text('Your library has', exact=False).wait_for(timeout=15000)
            field = page.get_by_role('textbox', name='Message your coach')
            box = field.bounding_box()
            nav = page.get_by_role('navigation', name='Main navigation').bounding_box()
            if width < 760:
                assert box['y'] + box['height'] < nav['y'], 'Composer overlaps mobile navigation'
            field.fill('Change Bench Press (Barbell) in Upper Body to 4 sets')
            page.get_by_role('button', name='Send message').click()
            page.get_by_role('region', name='Change preview').wait_for(timeout=15000)
            assert workspace(page)['routines'][0] == original, 'Preview changed stored data'
            field.fill('do not approve')
            page.get_by_role('button', name='Send message').click()
            page.get_by_text('No changes have been applied', exact=False).wait_for(timeout=15000)
            assert workspace(page)['routines'][0] == original, 'Chat text applied a change'
            page.get_by_role('button', name='Apply changes', exact=True).click()
            page.get_by_text('This change is saved only', exact=False).wait_for(timeout=15000)
            changed = workspace(page)['routines'][0]
            assert len(changed['exercises'][0]['sets']) == 4
            assert changed['exercises'][1:] == original['exercises'][1:]
            assert changed['description'] == original['description']
            page.get_by_role('button', name='New conversation').click()
            field.fill('Plan a workout')
            page.get_by_role('button', name='Send message').click()
            page.get_by_role('region', name='Change preview').wait_for(timeout=15000)
            page.get_by_role('button', name='Discard preview', exact=True).click()
            page.get_by_role('region', name='Change preview').wait_for(state='detached')
            assert len(workspace(page)['routines']) == 2
            page.get_by_role('button', name='Progress', exact=True).click()
            page.get_by_role('heading', name='Progress', exact=True).wait_for()
            page.get_by_role('button', name='Profile', exact=True).click()
            page.get_by_role('button', name='Refine short-term goal with AI').click()
            page.get_by_role('heading', name='Suggested goal').wait_for()
            page.get_by_role('button', name='Discard', exact=True).click()
            page.reload()
            page.get_by_role('heading', name='Your workouts', exact=True).wait_for()
            assert len(workspace(page)['routines'][0]['exercises'][0]['sets']) == 4
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Workspace overflow'
            assert not errors, errors
            print(f'{width}×{height}: factual replies, edit preview/apply, negative approval, exact preservation, '
                  'create/discard, progress, goal preview, reload persistence and layout passed')
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
