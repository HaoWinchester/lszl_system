"""Knowledge-node explanations: real HTTP, native AAC playback and lifecycle."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / 'artifacts/knowledge-audio'
OUT.mkdir(parents=True, exist_ok=True)
AUDIO = (ROOT / 'tests/fixtures/knowledge-audio.m4a').read_bytes()
NODES = [
    {'id': 'a', 'subject': 'PMP', 'taxonomyId': 'tax', 'primaryNodeId': 'node-a', 'title': '参与计划', 'path': ['PMP', '人', '区分三类文档', '参与计划'], 'audioCount': 1},
    {'id': 'b', 'subject': 'PMP', 'taxonomyId': 'tax', 'primaryNodeId': 'node-b', 'title': '储备分析', 'path': ['PMP', '过程', '监督风险', '储备分析'], 'audioCount': 1},
    {'id': 'c', 'subject': 'PMP', 'taxonomyId': 'tax', 'primaryNodeId': 'node-c', 'title': '没有讲解', 'path': ['PMP', '人', '没有讲解']},
    {'id': 'd', 'subject': 'PMP', 'taxonomyId': 'tax', 'primaryNodeId': 'node-d', 'title': '空讲解', 'path': ['PMP', '过程', '空讲解'], 'audioCount': 1},
    {'id': 'e', 'subject': 'PMP', 'taxonomyId': 'tax', 'primaryNodeId': 'node-e', 'title': '更多讲解', 'path': ['PMP', '环境', '更多讲解'], 'audioCount': 21},
]
STATE = {'requests': [], 'fail_node': '', 'fail_audio': False, 'fail_script': False,
         'delay_node': '', 'unsupported': False, 'release_delay': threading.Event()}
HTML = '''<!doctype html><html lang="zh" data-release="audio-test"><head>
<link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/knowledge-dashboard.css">
<script src="/src/feature-assets.js"></script><script src="/src/practice/knowledge-space-scene.js"></script>
<script>window.owner='A';KGAuthCore={currentUser:()=>owner?{username:owner}:null};
KGDomainApi={request:async o=>{const r=await fetch(o.path,{signal:o.signal});if(!r.ok)throw Object.assign(Error('http'),{status:r.status});return r.json()}};
const real=KGKnowledgeSpaceScene;KGKnowledgeSpaceScene={...real,mount:o=>window.scene=real.mount(o)};
</script><script src="/src/practice/knowledge-dashboard.js"></script></head>
<body><button data-knowledge-dashboard-open>知识星空</button></body></html>'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass

    def send(self, status, data, content_type='application/json', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        url = urlparse(self.path)
        STATE['requests'].append((url.path, self.headers.get('Range'), parse_qs(url.query)))
        if url.path == '/fixture':
            return self.send(200, HTML.encode(), 'text/html; charset=utf-8')
        if url.path == '/api/v1/learning/practice/knowledge-universe':
            return self.send(200, json.dumps({'nodes': NODES, 'attemptCount': 0}).encode())
        if url.path == '/src/practice/knowledge-audio-controller.js' and STATE['fail_script']:
            return self.send(503, b'unavailable', 'text/plain')
        match = re.fullmatch('/api/v1/learning/knowledge-nodes/tax/(node-[a-e])/audios', url.path)
        if match:
            node = match[1]
            if node == STATE['delay_node']:
                STATE['release_delay'].wait(15)
            if node == STATE['fail_node']:
                return self.send(503, b'{}')
            size = 0 if node == 'node-d' else 21 if node == 'node-e' else 1
            offset = int(parse_qs(url.query).get('offset', ['0'])[0])
            items = [{'id': f'{node}-{i}', 'title': ('储备 <安全>讲解' if node == 'node-b' else '参与计划讲解') + f' {i+1}',
                      'durationMs': 6000, 'byteLength': len(AUDIO), 'mimeType': 'audio/unsupported' if STATE['unsupported'] else 'audio/mp4',
                      'contentUrl': f'/api/v1/learning/knowledge-audios/{node}-{i}/content'}
                     for i in range(offset, min(offset + 20, size))]
            return self.send(200, json.dumps({'items': items, 'total': size, 'offset': offset, 'limit': 20}).encode())
        if re.fullmatch('/api/v1/learning/knowledge-audios/node-[a-e]-\d+/content', url.path):
            if STATE['fail_audio']:
                return self.send(503, b'{}')
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', self.headers.get('Range', ''))
            if match:
                start = int(match[1]); end = min(int(match[2]) if match[2] else len(AUDIO)-1, len(AUDIO)-1)
                return self.send(206, AUDIO[start:end+1], 'audio/mp4',
                    {'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{len(AUDIO)}'})
            return self.send(200, AUDIO, 'audio/mp4', {'Accept-Ranges': 'bytes'})
        return super().do_GET()


def resource_requests():
    return [r for r in STATE['requests'] if '/knowledge-nodes/' in r[0]]


def content_requests():
    return [r for r in STATE['requests'] if '/knowledge-audios/' in r[0]]


def choose(page, node):
    page.locator(f'[data-knowledge-node="{node}"]').click()


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        for width in (1440, 390):
            STATE.update(requests=[], fail_node='', fail_audio=False, fail_script=False, delay_node='')
            STATE['release_delay'].set()
            context = browser.new_context(viewport={'width': width, 'height': 960 if width > 600 else 844}, reduced_motion='reduce')
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/fixture'); page.get_by_role('button', name='知识星空', exact=True).click()
            page.wait_for_function('window.scene && scene.snapshot().settled')
            page.evaluate('scene.setAutoRotate(false)')
            entry = page.locator('[data-knowledge-audio-open]')
            expect(entry).to_be_visible()
            assert not resource_requests() and not content_requests()
            assert not any('/knowledge-audio-controller.js' in r[0] for r in STATE['requests']), 'Controller must be demand-loaded'
            page.locator('[data-knowledge-group]').filter(has_text='PMP · 过程 / 2').click()
            expect(entry).to_be_visible()
            assert not resource_requests(), 'Selecting a different star/category must not request explanations'
            page.locator('[data-knowledge-group]').filter(has_text='全部考点').click()
            entry.click()
            panel = page.locator('[data-knowledge-audio-panel]')
            play = panel.locator('[data-knowledge-audio-play]').first
            expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            assert len(resource_requests()) == 1 and not content_requests(), 'Metadata must not prefetch audio bytes'
            assert page.locator('dialog img').count() == 0
            audio = panel.locator('audio')
            assert audio.get_attribute('preload') == 'none' and audio.get_attribute('src') is None
            assert panel.evaluate('e=>e.scrollWidth<=e.clientWidth')
            play.click()
            page.wait_for_function('document.querySelector("[data-knowledge-audio-panel] audio").currentTime>.1')
            assert audio.evaluate('a=>!a.paused&&Number.isFinite(a.duration)&&a.duration>5')
            assert content_requests() and any(r[1] for r in content_requests()), 'Native AAC delivery must exercise HTTP Range'
            bounds=audio.bounding_box();dialog_bounds=page.locator('.kg-knowledge-detail').bounding_box()
            assert bounds['width']>=200 and bounds['x']+bounds['width']<=dialog_bounds['x']+dialog_bounds['width']-10
            page.screenshot(path=str(OUT/f'knowledge-audio-{width}.png'))
            audio.evaluate('a=>{a.currentTime=3;a.playbackRate=1.5}')
            page.wait_for_function('document.querySelector("audio").currentTime>=3')
            assert audio.evaluate('a=>a.playbackRate') == 1.5
            audio.evaluate('a=>a.pause()'); assert audio.evaluate('a=>a.paused')
            play.click(); page.wait_for_function('!document.querySelector("audio").paused')
            choose(page, 0)
            expect(play).to_have_text('播放讲解：参与计划讲解 1')
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")'), 'Switching nodes must stop and release the old stream'
            choose(page, 2)
            expect(panel).not_to_be_visible()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            choose(page, 3); expect(panel).to_contain_text('暂无音频讲解')
            assert panel.locator('[data-knowledge-audio-play]').count() == 0
            choose(page, 4)
            expect(panel.locator('[data-knowledge-audio-play]')).to_have_count(20)
            before = len(resource_requests())
            panel.locator('[data-knowledge-audio-more]').click()
            expect(panel.locator('[data-knowledge-audio-play]')).to_have_count(21)
            assert len(resource_requests()) == before + 1 and resource_requests()[-1][2]['offset'] == ['20']
            STATE['fail_node'] = 'node-b'
            choose(page, 1); expect(panel.locator('[data-knowledge-audio-retry]')).to_be_visible()
            STATE['fail_node'] = ''
            panel.locator('[data-knowledge-audio-retry]').click(); expect(play).to_be_visible()
            STATE['unsupported'] = True
            choose(page, 0); expect(play).to_have_text('播放讲解：参与计划讲解 1')
            before_unsupported = len(content_requests());play.click()
            expect(panel).to_contain_text('暂不支持此音频格式')
            assert len(content_requests()) == before_unsupported and audio.get_attribute('src') is None
            STATE['unsupported'] = False
            choose(page, 1); expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            # Use an unplayed resource: Chromium can retain decoded bytes even
            # after clearing src, so failing a previously buffered URL is not a network test.
            choose(page, 0); expect(play).to_have_text('播放讲解：参与计划讲解 1')
            STATE['fail_audio'] = True
            before_media = len(content_requests())
            play.click()
            try:
                expect(panel.locator('[data-knowledge-audio-play-retry]')).to_be_visible()
            except AssertionError:
                print('media failure evidence', audio.evaluate('a=>({src:a.getAttribute("src"),paused:a.paused,error:a.error?.code,readyState:a.readyState,networkState:a.networkState})'), content_requests()[before_media:])
                raise
            STATE['fail_audio'] = False
            panel.locator('[data-knowledge-audio-play-retry]').click()
            page.wait_for_function('!document.querySelector("audio").paused&&document.querySelector("audio").currentTime>.1')
            page.locator('[data-knowledge-details-close]').click()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            page.locator('[data-knowledge-audio-open]').click(); expect(play).to_be_visible()
            choose(page, 1); expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            STATE['delay_node'] = 'node-a'; STATE['release_delay'].clear()
            choose(page, 0)
            page.wait_for_function('document.querySelector("[data-knowledge-audio-panel]").getAttribute("aria-busy")==="true"')
            choose(page, 1); expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            STATE['release_delay'].set(); STATE['delay_node'] = ''
            page.wait_for_function('document.querySelector("[data-knowledge-audio-panel]").getAttribute("aria-busy")==="false"')
            expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            play.click(); page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate("owner='B';dispatchEvent(new Event('kg-auth-session-change'))")
            expect(page.locator('.kg-knowledge-detail')).not_to_be_visible()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            assert panel.locator('[data-knowledge-audio-play]').count() == 0
            page.locator('[data-knowledge-audio-open]').click(); expect(play).to_be_visible(); play.click()
            page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate('KGKnowledgeDashboard.init().refresh()')
            expect(page.locator('.kg-knowledge-detail')).not_to_be_visible()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            page.locator('[data-knowledge-audio-open]').click(); expect(play).to_be_visible(); play.click()
            page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate('document.querySelector(".kg-knowledge-detail").close()')
            page.wait_for_function('document.querySelector("audio").paused&&!document.querySelector("audio").hasAttribute("src")', timeout=3000)
            page.locator('[data-knowledge-audio-open]').click(); expect(play).to_be_visible(); play.click()
            page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate('''()=>{
                document.querySelector('.kg-knowledge-detail').close();
                document.querySelector('[data-knowledge-node="1"]').click();
                document.querySelector('[data-knowledge-audio-open]').click();
            }''')
            expect(play).to_have_text('播放讲解：储备 <安全>讲解 1')
            play.click(); page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate('KGKnowledgeDashboard.close()')
            expect(page.locator('#kgKnowledgeDashboard')).not_to_be_visible()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            page.get_by_role('button', name='知识星空', exact=True).click()
            page.locator('[data-knowledge-audio-open]').click(); expect(play).to_be_visible(); play.click()
            page.wait_for_function('!document.querySelector("audio").paused')
            page.evaluate("dispatchEvent(new Event('pagehide'))")
            expect(page.locator('#kgKnowledgeDashboard')).not_to_be_visible()
            assert audio.evaluate('a=>a.paused&&!a.hasAttribute("src")')
            assert not errors, errors
            print(f'PASS {width}: demand-only metadata/media, native AAC/Range/play/pause/seek/rate, paging, empty, retry, stale-node and account/close cleanup')
            context.close()
        # A script network failure must leave the existing detail usable and retryable.
        STATE.update(requests=[], fail_script=True, fail_node='', fail_audio=False)
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.goto(base + '/fixture'); page.get_by_role('button', name='知识星空', exact=True).click()
        page.locator('[data-knowledge-audio-open]').click()
        expect(page.locator('[data-knowledge-audio-load-retry]')).to_be_visible()
        STATE['fail_script'] = False
        page.locator('[data-knowledge-audio-load-retry]').click()
        expect(page.locator('[data-knowledge-audio-play]')).to_be_visible()
        page.locator('[data-knowledge-details-close]').click()
        page.locator('[data-knowledge-close]').click()
        print('PASS script failure/retry and ordinary detail/close recovery')
        browser.close()
finally:
    STATE['release_delay'].set()
    server.shutdown(); server.server_close()
