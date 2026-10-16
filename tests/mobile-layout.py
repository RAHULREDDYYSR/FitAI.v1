"""Touch layout checks, including landscape and reduced-height coach controls.

Start the production app, then run python tests/mobile-layout.py.
Uses the browser-local sample workspace; no live model or account writes.
"""
import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).resolve().parent / 'artifacts' / 'mobile-layout'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'results.json').unlink(missing_ok=True)
for previous_failure in OUT.glob('*-failure.png'):
    previous_failure.unlink()
SIZES = [(320,568),(360,640),(375,667),(390,844),(393,852),(412,915),(430,932),(568,320),(740,360),(844,390)]
results=[]

def geometry(page,label):
    page.wait_for_function("!document.querySelector('.workspace-main')?.firstElementChild || getComputedStyle(document.querySelector('.workspace-main').firstElementChild).transform === 'none'")
    data=page.evaluate('''() => { const main=document.querySelector('.workspace-main'); return {viewport: innerWidth, documentWidth:document.documentElement.scrollWidth, mainWidth:main?.clientWidth, mainScroll:main?.scrollWidth}; }''')
    assert data['documentWidth'] <= data['viewport'], f'{label}: document overflow {data}'
    if data['mainWidth'] is not None:
        assert data['mainScroll'] <= data['mainWidth'] + 1, f'{label}: main content overflow {data}'

def usable(page,locator,label):
    expect(locator).to_be_visible()
    locator.scroll_into_view_if_needed()
    box=locator.bounding_box()
    width,height=page.evaluate('[innerWidth, innerHeight]')
    assert box and box['x'] >= -1 and box['x']+box['width'] <= width+1, f'{label}: horizontal clipping {box}'
    assert box['y'] >= -1 and box['y']+box['height'] <= height+1, f'{label}: vertical clipping {box}'
    clear=locator.evaluate('''e=>{ const r=e.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return !!hit&&(e.contains(hit)||hit.contains(e)); }''')
    assert clear, f'{label}: another element covers the control'

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('FITAI_TEST_CHROMIUM', '/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height in SIZES:
        context=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,reduced_motion='reduce')
        page=context.new_page()
        page.set_default_timeout(8000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        checks=[]
        try:
            page.goto(os.environ.get('FITAI_TEST_BASE_URL', 'http://127.0.0.1:3000'),wait_until='domcontentloaded')
            explore=page.get_by_role('button',name='Explore sample workspace')
            usable(page,explore,'Landing explore')
            geometry(page,'landing')
            explore.tap()
            page.get_by_role('heading',name='Your workouts',exact=True).wait_for()
            geometry(page,'Workouts')
            usable(page,page.get_by_role('button',name='Create routine'),'Create routine')
            if width in (320,390,430):
                page.wait_for_timeout(300)
                page.screenshot(path=str(OUT/f'{width}-workouts.png'))
            checks.append('landing/workouts')
            nav=page.get_by_role('navigation',name='Main navigation')
            for name in ['Coach','Progress','Profile','Workouts']:
                usable(page,nav.get_by_role('button',name=name,exact=True),f'{name} navigation')
            nav.get_by_role('button',name='Coach',exact=True).tap()
            field=page.get_by_role('textbox',name='Message your coach')
            field.wait_for()
            usable(page,field,'Coach composer')
            geometry(page,'Coach')
            page.get_by_role('button',name='List my routines',exact=True).tap()
            page.get_by_text('Your library has',exact=False).wait_for()
            field.fill('Change Bench Press (Barbell) in Upper Body to 4 sets')
            send=page.get_by_role('button',name='Send message')
            usable(page,send,'Send message')
            send.tap()
            preview=page.get_by_role('region',name='Change preview')
            preview.wait_for()
            apply=page.get_by_role('button',name='Apply changes',exact=True)
            usable(page,apply,'Apply preview')
            geometry(page,'Coach preview')
            discard=page.get_by_role('button',name='Discard preview',exact=True)
            discard.tap()
            if width <= 430:
                field.focus()
                page.set_viewport_size({'width':width,'height':max(360,height-280)})
                usable(page,field,'Reduced-height composer')
                usable(page,send,'Reduced-height send')
                geometry(page,'Reduced-height coach')
                for name in ['Coach','Progress','Profile','Workouts']:
                    usable(page,nav.get_by_role('button',name=name,exact=True),f'Reduced-height {name} navigation')
                page.set_viewport_size({'width':width,'height':height})
            checks.append('coach/facts/preview/reduced-height')
            nav.get_by_role('button',name='Progress',exact=True).tap()
            page.get_by_role('heading',name='Progress',exact=True).wait_for()
            page.get_by_role('button',name='Matrix',exact=True).tap()
            time=page.get_by_role('button',name='Show Time Matrix',exact=True)
            usable(page,time,'Show Time Matrix')
            time.tap()
            geometry(page,'Progress matrix')
            page.get_by_role('button',name='custom',exact=True).tap()
            usable(page,page.get_by_label('Start',exact=True),'Start date')
            usable(page,page.get_by_label('End',exact=True),'End date')
            geometry(page,'Progress date fields')
            checks.append('progress/matrix/date-fields')
            nav.get_by_role('button',name='Profile',exact=True).tap()
            page.get_by_role('heading',name='Alex',exact=True).wait_for()
            page.get_by_role('button',name='Edit profile',exact=True).tap()
            usable(page,page.get_by_label('Weight (kg)',exact=True),'Profile weight')
            geometry(page,'Profile editor')
            page.get_by_role('button',name='Cancel profile edit',exact=True).tap()
            usable(page,page.get_by_role('button',name='Sign Out',exact=True),'Profile final control')
            checks.append('profile/forms/final-control')
            assert not errors, f'Browser errors: {errors}'
            results.append({'width':width,'height':height,'status':'passed','checks':checks,'errors':errors})
            print(f'PASS {width}x{height}: '+', '.join(checks),flush=True)
        except Exception as error:
            page.screenshot(path=str(OUT/f'{width}x{height}-failure.png'))
            results.append({'width':width,'height':height,'status':'failed','checks':checks,'error':str(error),'browserErrors':errors})
            print(f'FAIL {width}x{height}: {error}',flush=True)
        finally:
            context.close()
    browser.close()
(OUT/'results.json').write_text(json.dumps(results,indent=2))
assert all(row['status']=='passed' for row in results), 'Some mobile layout checks failed; see results.json'
