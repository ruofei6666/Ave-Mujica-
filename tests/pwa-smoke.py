"""Check the built PWA on a Pages-style subpath, or pass --url for a live site.

Requires Python Playwright and a Chromium browser. Local mode additionally
checks safe updates, failed installs and preservation of other projects' caches.
"""
import argparse
import json
import mimetypes
import threading
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'dist' / 'client'
PREFIX = '/Ave-Mujica-/'
release = {'suffix': '', 'reject': ''}


class StaticSite(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # A failed atomic precache intentionally cancels sibling requests.
            pass

    def do_GET(self):
        pathname = unquote(urlparse(self.path).path)
        if pathname == '/pwa-test-origin.html':
            content, mime = b'<!doctype html><title>Isolated test origin</title>', 'text/html'
        elif pathname.startswith(PREFIX):
            name = pathname[len(PREFIX):] or 'index.html'
            target = (BUILD / name).resolve()
            if not target.is_relative_to(BUILD.resolve()) or not target.is_file() or name == release['reject']:
                self.send_error(404)
                return
            content = target.read_bytes()
            mime = {'js': 'text/javascript', 'webmanifest': 'application/manifest+json'}.get(target.suffix[1:]) or mimetypes.guess_type(name)[0] or 'application/octet-stream'
            if name == 'sw.js' and release['suffix']:
                content = content.replace(b"const VERSION = '", f"const VERSION = '{release['suffix']}".encode(), 1)
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Public deployment URL; skips simulated server updates')
    parser.add_argument('--browser', default='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    args = parser.parse_args()
    report = {'url': args.url, 'checks': [], 'browserErrors': []}
    server = None
    profile = tempfile.TemporaryDirectory(prefix='ave-pwa-')

    def passed(name, **detail):
        report['checks'].append({'name': name, **detail})
        print('PASS', name, json.dumps(detail, ensure_ascii=True), flush=True)

    try:
        if not args.url:
            server = ThreadingHTTPServer(('127.0.0.1', 0), StaticSite)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        url = args.url or f'http://127.0.0.1:{server.server_port}{PREFIX}'
        report['url'] = url
        with sync_playwright() as playwright:
            # Persistent isolated profile: incognito always reports non-installable.
            context = playwright.chromium.launch_persistent_context(profile.name, headless=True,
                executable_path=args.browser if Path(args.browser).is_file() else None,
                viewport={'width': 844, 'height': 390}, is_mobile=True, has_touch=True)
            page = context.new_page()
            page.set_default_timeout(30000)
            page.on('pageerror', lambda error: report['browserErrors'].append(str(error)))
            if server:
                page.goto(f'http://127.0.0.1:{server.server_port}/pwa-test-origin.html')
                page.evaluate("async () => { const c = await caches.open('unrelated-project'); await c.put('/sentinel', new Response('keep')); }")
            page.goto(url, wait_until='networkidle', timeout=120000)
            page.wait_for_function("document.querySelector('#pwa-status')?.textContent === '离线可玩'", timeout=120000)
            page.wait_for_function('window.AveGame && window.MujicaArt?.ready')
            if page.locator('#help-dialog').evaluate('(el) => el.open'):
                page.locator('#help-done').click()
            keys = page.evaluate("async () => { const key = (await caches.keys()).find(k => k.startsWith('ave-mujica-pwa-')); return (await (await caches.open(key)).keys()).map(r => r.url); }")
            assert len(keys) > 70, f'Incomplete precache: {len(keys)}'
            assert all(key.startswith(url) for key in keys)
            assert not any(key.endswith('/sw.js') or key.endswith('/health') for key in keys)
            passed('complete precache within repository subpath', files=len(keys))

            cdp = context.new_cdp_session(page)
            manifest = cdp.send('Page.getAppManifest')
            assert not manifest['errors'], manifest
            data = json.loads(manifest['data'])
            assert data['start_url'] == './' and data['scope'] == './'
            assert data['display'] in ('standalone', 'fullscreen')
            errors = cdp.send('Page.getInstallabilityErrors')['installabilityErrors']
            assert not errors, errors
            assert page.locator('#install-btn').is_visible()
            passed('valid manifest, icons and Chromium installability')

            for width, height in [(1440, 900), (844, 390), (390, 844), (320, 568)]:
                page.set_viewport_size({'width': width, 'height': height})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow at {width}'
            page.set_viewport_size({'width': 844, 'height': 390})
            passed('installation controls fit desktop and mobile viewports')

            context.set_offline(True)
            page.goto(url + '?offline=pwa-check', wait_until='networkidle')
            page.wait_for_function('window.AveGame && window.MujicaArt?.ready')
            page.wait_for_function("document.querySelector('#pwa-status')?.textContent === '离线可玩'")
            assert page.evaluate('window.MujicaArt.failures.length') == 0
            assert 'bg-menu' in page.locator('html').get_attribute('data-art')
            failures = page.evaluate("""async urls => {
                const bad = [];
                for (const url of urls) {
                    const r = await fetch(url + '?cache-check=offline');
                    if (!r.ok || !(await r.arrayBuffer()).byteLength) bad.push(url);
                }
                return bad;
            }""", keys)
            assert not failures, failures
            passed('offline reload with query strings loads all images, sounds, fonts and chunks')
            page.locator('#start-btn').click()
            page.wait_for_function("window.AveGame.getState().screen === 'battle' && window.AveGame.getState().snapshot?.frame > 100")
            passed('offline PVE reaches a running combat simulation')

            if server:
                context.set_offline(False)
                page.evaluate('window.__pwaDocument = true')
                release['suffix'] = 'upgrade-'
                page.evaluate('async () => (await navigator.serviceWorker.getRegistration()).update()')
                page.wait_for_function('async () => !!(await navigator.serviceWorker.getRegistration()).waiting')
                assert page.evaluate('window.__pwaDocument') is True
                assert page.evaluate('window.AveGame.getState().screen') == 'battle'
                passed('new release waits without refreshing an active fight')
                page.locator('#pause-btn').click()
                page.locator('#quit-btn').click()
                with page.expect_navigation(wait_until='networkidle'):
                    page.locator('#update-app-btn').click()
                page.wait_for_function("document.querySelector('#pwa-status')?.textContent === '离线可玩'")
                names = page.evaluate('caches.keys()')
                own = [name for name in names if name.startswith('ave-mujica-pwa-')]
                assert len(own) == 1 and 'upgrade-' in own[0], names
                assert 'unrelated-project' in names
                passed('accepted update activates and only removes its own old cache')

                release['suffix'] = 'broken-'
                release['reject'] = 'assets/icons/icon-512.png'
                result = page.evaluate("""async () => {
                    const registration = await navigator.serviceWorker.getRegistration();
                    const failed = new Promise(resolve => registration.addEventListener('updatefound', () => {
                        const worker = registration.installing;
                        worker.addEventListener('statechange', () => {
                            if (worker.state === 'redundant') resolve(true);
                            if (worker.state === 'installed') resolve(false);
                        });
                    }, {once: true}));
                    await registration.update();
                    return failed;
                }""")
                assert result is True
                names = page.evaluate('caches.keys()')
                assert own[0] in names and not any('broken-' in name for name in names), names
                context.set_offline(True)
                page.reload(wait_until='networkidle')
                page.wait_for_function('window.AveGame && window.MujicaArt?.ready')
                passed('failed precache preserves the installed offline release')

            assert not report['browserErrors'], report['browserErrors']
            passed('no uncaught browser errors')
            report['passed'] = True
            context.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        profile.cleanup()
        output = ROOT / '.scratch' / ('pwa-live-report.json' if args.url else 'pwa-local-report.json')
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print('REPORT', output, flush=True)


if __name__ == '__main__':
    main()
