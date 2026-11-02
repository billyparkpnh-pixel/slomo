"""End-to-end checks. Requires Python Playwright and Chromium, not app dependencies.
Run from the checkout: python3 tests/browser.py
Uses a separate temporary database and does not change preview bookings.
"""
import os
import json
import fitz
from datetime import date
import re
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='slomo-browser-') as data:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    password=secrets.token_hex(16)
    env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'DATA_DIR':data,'ADMIN_PASSWORD':password,'SITE_URL':base,'NODE_ENV':'test','DEMO_MODE':'true','RESEND_API_KEY':'','MAIL_FROM':''}
    with open(Path(data)/'server.log','w') as log:
        process=subprocess.Popen(['node','server/index.js'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            for attempt in range(100):
                try:
                    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(base+'/api/health',timeout=1)
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Test server did not start')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':1000})
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base,wait_until='networkidle')
                expect(page.locator('[data-table]')).to_have_count(60)
                assert 'SLOMO Editorial' in page.locator('h1').evaluate('(el)=>getComputedStyle(el).fontFamily')
                assert 'SLOMO Editorial' not in page.locator('#book-submit').evaluate('(el)=>getComputedStyle(el).fontFamily')
                assert 'SLOMO Editorial' not in page.locator('.wordmark').first.evaluate('(el)=>getComputedStyle(el).fontFamily')
                assert page.locator('#experience').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(11, 24, 38)'
                expect(page.locator('.event-placeholder')).to_contain_text('TO BE ANNOUNCED')
                page.wait_for_timeout(1800)
                # New public UI controls must retain table semantics and navigation.
                expect(page.locator('#instagram-link')).to_have_attribute('href','https://www.instagram.com/slomocambodia/')
                page.locator('#motion-toggle').click()
                expect(page.locator('#motion-toggle')).to_have_attribute('aria-pressed','true')
                page.locator('#motion-toggle').click()
                expect(page.locator('#motion-toggle')).to_have_attribute('aria-pressed','false')
                page.locator('[data-table-filter="turquoise"]').click()
                expect(page.locator('[data-table="T7"]')).to_have_class(re.compile('is-highlight-muted'))
                assert 'is-highlight-muted' not in page.locator('[data-table="T48"]').get_attribute('class')
                page.locator('[data-pick-type="vip"]').click()
                expect(page.locator('[data-table-filter="vip"]')).to_have_attribute('aria-pressed','true')
                page.locator('[data-table-filter="all"]').click()
                assert page.locator('[data-table="V4"]').get_attribute('aria-disabled')=='true'
                page.locator('[data-table="T48"]').click()
                expect(page.locator('[data-table="T48"]')).to_have_attribute('aria-pressed','true')
                expect(page.locator('#selected-table')).to_contain_text('6 bottles of beer')
                page.locator('#guests').select_option('4')
                page.locator('#full-name').fill('Sample Guest')
                page.locator('#phone').fill('+855 12 555 555')
                page.locator('#email').fill('browser@example.com')
                page.locator('#consent').check()
                posted=[]
                page.on('request',lambda req:posted.append(req.url) if req.method=='POST' and req.url.endswith('/api/bookings') else None)
                page.locator('#book-submit').click()
                expect(page.locator('#review-dialog')).to_be_visible()
                expect(page.locator('#review-content')).to_contain_text('Sample Guest')
                expect(page.locator('#review-content')).to_contain_text('6 bottles of beer')
                assert not posted,'A reservation was submitted before review confirmation'
                page.locator('#review-edit').click()
                expect(page.locator('#full-name')).to_have_value('Sample Guest')
                page.locator('#book-submit').click()
                page.locator('#review-confirm').click()
                expect(page.locator('#reservation-dialog')).to_be_visible()
                assert len(posted)==1,'Confirmation created duplicate requests'
                reference=page.locator('.ticket-reference strong').inner_text()
                assert re.fullmatch(r'SLM-[A-F0-9]{12}',reference)
                expect(page.locator('#dialog-content')).to_contain_text('Local email outbox',ignore_case=True)
                token=page.locator('#manage-token').input_value()
                # A temporary download failure must not lose the successful reservation.
                page.route('**/api/reservations/ticket',lambda route:route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':'Temporary ticket service failure. Please retry.'})))
                page.locator('#download-ticket').click()
                expect(page.locator('#ticket-error')).to_contain_text('Please retry')
                expect(page.locator('.ticket-reference strong')).to_have_text(reference)
                page.unroute('**/api/reservations/ticket')
                with page.expect_download() as download_info:
                    page.locator('#download-ticket').click()
                download=download_info.value
                assert download.suggested_filename==f'SLOMO-Reservation-{reference}.pdf'
                ticket_path=Path(data)/'reservation.pdf'
                download.save_as(ticket_path)
                ticket_bytes=ticket_path.read_bytes()
                assert ticket_bytes.startswith(b'%PDF-')
                document=fitz.open(ticket_path);assert len(document)==1
                ticket=document[0].get_text()
                assert all(value in ticket for value in (reference,'Sample Guest','T48','6 bottles of beer','CONFIRMED','Street 55','+855 87 330 003'))
                booking_date=date.fromisoformat(page.locator('#booking-date').input_value())
                expected_date=f'{booking_date:%A}, {booking_date.day} {booking_date:%B %Y}'
                assert expected_date in ticket
                assert re.search(r'NUMBER OF GUESTS\s+4',ticket)
                assert token not in ticket and token.encode() not in ticket_bytes
                assert 'browser@example.com' not in ticket and '+855 12 555 555' not in ticket
                assert all(word not in ticket.lower() for word in ('management code','cancellation token','api key'))
                forged=page.request.post(base+'/api/reservations/ticket',data={'reference':reference,'email':'browser@example.com','name':'Forged Customer','table':'V10','guests':99})
                assert forged.ok
                with fitz.open(stream=forged.body(),filetype='pdf') as real_record:
                    actual=real_record[0].get_text()
                    assert 'Sample Guest' in actual and 'T48' in actual and 'Forged Customer' not in actual
                pixmap=document[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=True)
                rgba_path=Path(data)/'ticket.rgba';rgba_path.write_bytes(pixmap.samples)
                qr_url=subprocess.check_output(['node','scripts/inspect-ticket-qr.js',str(rgba_path),str(pixmap.width),str(pixmap.height)],cwd=ROOT,text=True).strip()
                assert qr_url==base+'/#booking',qr_url
                qr_page=browser.new_page(viewport={'width':390,'height':844})
                qr_page.goto(qr_url,wait_until='networkidle')
                expect(qr_page.locator('#lookup-reference')).to_have_value('')
                expect(qr_page.locator('#lookup-email')).to_have_value('')
                expect(qr_page.locator('#reservation-dialog')).not_to_be_visible()
                qr_page.close()
                samples=Path('/workspace/shared/slomo-midnight');samples.mkdir(parents=True,exist_ok=True)
                (samples/'reservation-sample.pdf').write_bytes(ticket_bytes)
                document[0].get_pixmap(matrix=fitz.Matrix(1.7,1.7)).save(str(samples/'reservation-sample.png'))
                document.close()
                page.locator('#reservation-dialog .dialog-close').click()
                expect(page.locator('[data-table="T48"]')).to_have_attribute('aria-disabled','true')
                page.locator('#lookup-reference').fill(reference)
                page.locator('#lookup-email').fill('wrong@example.com')
                page.locator('#lookup-form button').click()
                expect(page.locator('#lookup-error')).to_contain_text('No reservation matches')
                page.locator('#lookup-email').fill('browser@example.com')
                page.locator('#lookup-form button').click()
                expect(page.locator('#reservation-dialog')).to_be_visible()
                page.locator('#show-cancel').click()
                page.locator('#manage-token').fill(token)
                page.locator('#cancel-reservation').click()
                expect(page.locator('#dialog-title')).to_have_text('Until next time.')
                with page.expect_download() as cancelled_download:
                    page.locator('#download-ticket').click()
                cancelled_download.value.save_as(Path(data)/'cancelled.pdf')
                with fitz.open(Path(data)/'cancelled.pdf') as cancelled_pdf:
                    assert 'CANCELLED' in cancelled_pdf[0].get_text()
                page.locator('#reservation-dialog .dialog-close').click()
                expect(page.locator('[data-table="T48"]')).to_have_attribute('aria-disabled','false')
                page.locator('[data-table="T49"]').focus()
                page.keyboard.press('Enter')
                expect(page.locator('[data-table="T49"]')).to_have_attribute('aria-pressed','true')
                # Terms and privacy are reachable and keyboard-dismissable.
                page.locator('.checkbox-label [data-policy="terms"]').click()
                expect(page.locator('#policy-dialog')).to_be_visible()
                page.keyboard.press('Escape')
                expect(page.locator('#policy-dialog')).not_to_be_visible()
                screenshots=ROOT/'test-results'
                screenshots.mkdir(exist_ok=True)
                for width in [1440,768,390,320]:
                    page.set_viewport_size({'width':width,'height':900})
                    page.goto(base,wait_until='networkidle')
                    page.wait_for_timeout(1700)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Horizontal overflow at {width}px'
                    page.screenshot(path=str(screenshots/f'site-{width}.png'),full_page=True)
                # Complete a second reservation on a mobile viewport.
                page.set_viewport_size({'width':390,'height':844})
                page.goto(base,wait_until='networkidle')
                page.locator('#menu-toggle').click()
                expect(page.locator('#main-navigation')).to_be_visible()
                expect(page.locator('#menu-toggle')).to_have_attribute('aria-expanded','true')
                page.locator('#main-navigation a[href="#experience"]').click()
                expect(page.locator('#menu-toggle')).to_have_attribute('aria-expanded','false')
                page.locator('#menu-toggle').click()
                page.keyboard.press('Escape')
                expect(page.locator('#menu-toggle')).to_have_attribute('aria-expanded','false')
                page.locator('#zoom-plan').click()
                expect(page.locator('#zoom-plan')).to_have_attribute('aria-pressed','true')
                assert page.locator('#floor-plan').evaluate('(el)=>el.scrollWidth>el.clientWidth')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.locator('#zoom-plan').click()
                page.locator('[data-table="V1"]').click()
                expect(page.locator('#selected-table')).to_contain_text('2 bottles of whiskey')
                page.locator('#full-name').fill('Mobile Guest')
                page.locator('#phone').fill('+855 12 555 555')
                page.locator('#email').fill('mobile@example.com')
                page.locator('#consent').check()
                page.locator('#book-submit').click()
                expect(page.locator('#review-dialog')).to_be_visible()
                page.locator('#review-confirm').click()
                expect(page.locator('#reservation-dialog')).to_be_visible()
                mobile_ref=page.locator('.ticket-reference strong').inner_text()
                assert mobile_ref!=reference
                with page.expect_download() as mobile_download:
                    page.locator('#download-ticket').click()
                mobile_download.value.save_as(Path(data)/'mobile-reservation.pdf')
                assert (Path(data)/'mobile-reservation.pdf').read_bytes().startswith(b'%PDF-')
                page.screenshot(path=str(screenshots/'mobile-confirmation.png'))
                # Admin authentication and reservation management.
                admin=browser.new_page(viewport={'width':1440,'height':1000})
                admin.on('pageerror',lambda e:errors.append(str(e)))
                admin.goto(base+'/admin',wait_until='networkidle')
                admin.locator('#admin-password').fill(password)
                admin.locator('#login-form button').click()
                expect(admin.locator('#dashboard')).to_be_visible()
                expect(admin.locator('#booking-list')).to_contain_text('Mobile Guest')
                expect(admin.locator('#stats')).to_contain_text('1')
                with admin.expect_download() as exported:
                    admin.locator('#export').click()
                exported.value.save_as(Path(data)/'bookings.csv')
                assert 'Mobile Guest' in (Path(data)/'bookings.csv').read_text()
                admin.screenshot(path=str(screenshots/'admin-desktop.png'),full_page=True)
                admin.locator('[data-tab="availability"]').click()
                admin.locator('#hold-table').select_option('T49')
                admin.locator('#hold-status').select_option('true')
                admin.locator('#hold-form button').click()
                expect(admin.locator('#admin-plan [data-table="T49"]')).to_have_attribute('aria-disabled','true')
                admin.locator('[data-tab="emails"]').click()
                expect(admin.locator('#email-list')).to_contain_text(mobile_ref)
                admin.locator('.view-email').first.click()
                expect(admin.locator('#email-preview')).to_be_visible()
                expect(admin.locator('#email-content')).to_contain_text('Mobile Guest')
                admin.locator('[data-tab="reservations"]').click()
                admin.locator('.cancel-booking').click()
                admin.locator('[data-confirm]').click()
                expect(admin.locator('#booking-list')).to_contain_text('cancelled')
                expect(admin.locator('.cancel-booking')).to_have_count(0)
                admin.set_viewport_size({'width':390,'height':844})
                assert admin.evaluate('document.documentElement.scrollWidth <= innerWidth'),'Admin mobile overflow'
                admin.screenshot(path=str(screenshots/'admin-mobile.png'),full_page=True)
                # Generate a tiny synthetic clip solely in the isolated test context.
                # This checks the existing admin media upload and public hero together.
                clip=admin.evaluate('''async()=>{
                    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
                    const context=canvas.getContext('2d');context.fillStyle='#1a5a70';context.fillRect(0,0,320,180);
                    const stream=canvas.captureStream(20);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];
                    const finished=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{const blob=new Blob(chunks,{type:'video/webm'});resolve(Array.from(new Uint8Array(await blob.arrayBuffer())));};});
                    recorder.start();
                    for(let frame=0;frame<14;frame++){
                        context.fillStyle=frame%2?'#1a5a70':'#246b80';context.fillRect(0,0,320,180);
                        context.fillStyle='#a4f1fa';context.fillRect(frame*20,0,20,180);
                        await new Promise(resolve=>setTimeout(resolve,60));
                    }
                    recorder.stop();
                    const result=await finished;stream.getTracks().forEach(track=>track.stop());return result;
                }''')
                assert len(clip)>100,'No test clip was recorded'
                admin.locator('[data-tab="settings"]').click()
                admin.locator('#video-file').set_input_files({'name':'hero-test.webm','mimeType':'video/webm','buffer':bytes(clip)})
                admin.locator('#video-upload button').click()
                expect(admin.locator('#setting-video')).to_have_value(re.compile(r'/media/.+\.webm'))
                media=browser.new_page(viewport={'width':1440,'height':900})
                media.goto(base,wait_until='networkidle')
                expect(media.locator('#hero-video')).to_have_js_property('readyState',4,timeout=10000)
                expect(media.locator('html')).to_have_class(re.compile('has-hero-video'))
                expect(media.locator('#hero-video')).to_have_js_property('paused',False)
                media.locator('#motion-toggle').click()
                assert media.locator('#hero-video').evaluate('(el)=>el.paused')
                media.locator('#motion-toggle').click()
                expect(media.locator('#hero-video')).to_have_js_property('paused',False)
                def missing_video(route):
                    response=route.fetch()
                    config=response.json();config['heroVideoUrl']='/missing-test-video.webm'
                    route.fulfill(response=response,json=config)
                media.route('**/api/config',missing_video)
                media.reload(wait_until='networkidle')
                expect(media.locator('#hero-video')).not_to_be_visible()
                expect(media.locator('.hero-sculpture')).to_be_visible()
                media.close()
                admin.locator('#logout').click()
                expect(admin.locator('#login-section')).to_be_visible()
                reduced=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
                reduced.goto(base,wait_until='networkidle')
                expect(reduced.locator('.intro')).not_to_be_visible()
                expect(reduced.locator('#motion-toggle')).to_have_attribute('aria-pressed','true')
                expect(reduced.locator('[data-table]')).to_have_count(60)
                assert reduced.locator('#hero-video').evaluate('(el)=>el.paused'),'Reduced motion must prevent autoplay'
                reduced.close()
                event_preview=browser.new_page(viewport={'width':1440,'height':900})
                fixture_event={'title':'Sample programme (test fixture)','date':'2026-12-12','image':'/visuals/light-field.svg','description':'Test fixture only.','details':['Sample event detail'],'link':'/'}
                event_preview.route('**/events-data.js*',lambda route:route.fulfill(content_type='text/javascript',body='export const events='+json.dumps([fixture_event])+';'))
                event_preview.goto(base,wait_until='networkidle')
                expect(event_preview.locator('.event-card h3')).to_have_text(fixture_event['title'])
                expect(event_preview.locator('.event-card time')).to_have_text('12 December 2026')
                expect(event_preview.locator('.event-card')).to_contain_text('Sample event detail')
                event_preview.close()
                assert not errors,errors
                browser.close()
                print('PASS: desktop and mobile bookings, keyboard selection, lookups, cancellation, terms, downloads, 4 responsive widths, category highlights, package links, mobile navigation, motion controls, reduced motion, Instagram link, admin login, reservations, holds, email outbox, CSV export, video upload/playback/pause, review before submission, genuine PDF downloads, rendered ticket details, QR privacy/lookup, download error recovery and logout. No JavaScript errors.')
        finally:
            process.terminate()
            process.wait(timeout=10)
