"""Check date filtering and body-weight validation in the sample workspace."""
import os
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium'),
                               args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
    page.set_default_timeout(8000)
    page.goto(os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000'), wait_until='domcontentloaded')
    page.get_by_role('button', name='Explore sample workspace').tap()
    page.get_by_role('button', name='Progress', exact=True).tap()
    page.get_by_role('heading', name='Progress', exact=True).wait_for()
    page.get_by_role('button', name='custom', exact=True).tap()
    page.get_by_label('Start', exact=True).fill('2000-01-01')
    page.get_by_label('End', exact=True).fill('2000-01-02')
    page.get_by_role('button', name='Matrix', exact=True).tap()
    expect(page.get_by_role('cell', name='No sessions match this date range.')).to_be_visible()
    expect(page.locator('table tbody tr')).to_have_count(1)
    page.get_by_role('button', name='all', exact=True).tap()
    expect(page.locator('table tbody tr')).to_have_count(5)
    page.get_by_role('button', name='Chart', exact=True).tap()
    field = page.get_by_label("Today's body weight in kilograms")
    save = page.get_by_role('button', name="Save today's body weight")
    field.fill('-1')
    expect(save).to_be_disabled()
    expect(page.get_by_text('Enter a weight from 20 to 500 kg.', exact=True)).to_be_visible()
    current = page.evaluate("JSON.parse(localStorage.getItem('fitai_sample_workspace_v1')).profile")
    field.fill('73.5')
    save.tap()
    expect(field).to_have_value('')
    updated = page.evaluate("JSON.parse(localStorage.getItem('fitai_sample_workspace_v1')).profile")
    assert updated['weight'] == 73.5
    assert len(updated['weightHistory']) == len(current['weightHistory']) + 1
    expand = page.get_by_role('button', name='Expand Upper Body workout details', exact=True).first
    expand.focus()
    page.keyboard.press('Space')
    expect(page.get_by_role('button', name='Collapse Upper Body workout details', exact=True).first).to_have_attribute('aria-expanded', 'true')
    browser.close()
    print('Progress matrix filters, invalid/valid body-weight save and keyboard expansion passed')
