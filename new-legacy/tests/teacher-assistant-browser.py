#!/usr/bin/env python3
"""Real DOM interaction tests; API routes are mocked, never production data."""
import copy
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        # Chromium attachment downloads may bypass Playwright routing.
        if self.path.startswith('/api/v1/teacher-assistant/sessions/one/export?format='):
            data = json.dumps(self.export_state['session']['plan']).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Disposition', 'attachment; filename=teacher-export.json')
            self.end_headers(); self.wfile.write(data)
            return
        super().do_GET()
    def log_message(self, *args):
        pass

def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    session = {'id': 'one', 'title': '习题课整理', 'revision': 1, 'messages': [], 'uploads': [], 'plan': None, 'job': None, 'receipt': None}
    state = {'session': session, 'fail': False, 'role': 'teacher', 'calls': [], 'execute': 0, 'previewFail': True, 'statusFail': 0}
    Handler.export_state = state
    def api(route):
        request = route.request
        url = request.url.split('/api/v1/')[-1]
        state['calls'].append((request.method, url, request.post_data))
        status = 200
        payload = {}
        if url == 'auth/me':
            payload = {'user': {'username': 'teacher', 'role': state['role']}}
        elif url == 'teacher-assistant/sessions' and request.method == 'GET':
            payload = {'sessions': [{'id': 'one', 'title': session['title']}] if state['session'] else []}
        elif url == 'teacher-assistant/sessions' and request.method == 'POST':
            state['session'] = copy.deepcopy(session)
            payload = {'session': state['session']}
        elif request.method == 'DELETE':
            state['session'] = None
            status = 204
        elif url.endswith('/status'):
            if state['statusFail']:
                state['statusFail'] -= 1
                route.abort('failed')
                return
            payload = {'revision': state['session']['revision'], 'job': state['session']['job']}
        elif url.endswith('/preview') and state['previewFail']:
            status, payload = 503, {'detail': '来源读取暂时失败'}
        elif url.endswith('/preview'):
            payload = {'sections': [{'location': '第 1 页', 'text': '原文保留', 'images': [{'url': '/api/v1/teacher-assistant/uploads/file/assets/page-1.png', 'name': 'page-1.png'}]}], 'warnings': []}
        elif '/assets/' in url:
            import base64
            route.fulfill(status=200, content_type='image/png', body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4x8AAAAASUVORK5CYII='))
            return
        elif '/export?format=' in url:
            route.fulfill(status=200, content_type='application/json', headers={'Content-Disposition': 'attachment; filename=teacher-export.json'}, body=json.dumps(state['session']['plan']))
            return
        elif url.endswith('/messages'):
            if state['fail']:
                status, payload = 503, {'detail': '模型暂时不可用，请重试'}
            else:
                body = request.post_data_json
                s = state['session']
                s['messages'].extend([{'role': 'user', 'content': body['content']}, {'role': 'assistant', 'content': '已更新私有方案，请核对。'}])
                s['revision'] += 1
                s['plan'] = {'summary': '25 题，保持多选与关联', 'items': [{'id': 'bank', 'name': '财务习题课', 'kind': 'questions', 'questions': [{'stem': '<script>多选原题</script>', 'type': 'multiple', 'options': {'A': '甲', 'B': '乙'}, 'answer': ['A', 'B'], 'clues': ['保留关联'], 'source': {'location': '第 1 页'}, 'aiAdditions': ['建议解析'], 'metadata': {'needsReview': True, 'sourceLocation': '第 1 页'}}], 'warnings': ['相似题仅提示'], 'blockers': [], 'source': {'uploadId': 'file', 'location': '第 1 页'}}], 'blockers': [], 'settings': {'nameSuffix': '习题课', 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['recall', 'induction'], 'duplicatePolicy': 'keep_copy'}}
                payload = {'session': s}
        elif url.endswith('/uploads'):
            assert 'name="files"' in request.post_data
            state['session']['uploads'] = [{'id': 'file', 'name': 'sample.json', 'size': 2, 'status': 'ready', 'warnings': [], 'previewUrl': '/api/v1/teacher-assistant/uploads/file/preview'}]
            payload = {'session': state['session']}
        elif url.endswith('/execute'):
            assert request.post_data_json['revision'] == state['session']['revision']
            state['execute'] += 1
            state['session']['job'] = {'id': 'job', 'status': 'running', 'kind': 'execute'}
            payload = {'session': state['session']}
        elif url.endswith('/cancel'):
            state['session']['job']['status'] = 'cancelled'
            payload = {'session': state['session']}
        elif url.endswith('/retry'):
            state['session']['job']['status'] = 'succeeded'
            state['session']['receipt'] = {'revision': state['session']['revision'], 'questionCount': 25, 'bankId': 'actual-bank', 'partialFailures': ['第二份材料待核对'], 'url': '/question-bank.html?bank=actual-bank', 'downloadUrl': '/api/v1/teacher-assistant/uploads/file/file'}
            payload = {'session': state['session']}
        else:
            payload = {'session': state['session']}
        route.fulfill(status=status, content_type='application/json', body='' if status == 204 else json.dumps(payload, ensure_ascii=False))
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            page.context.route('**/api/v1/**', api)
            page.goto(base + '/teacher-assistant.html')
            expect(page.locator('#new-session')).to_be_enabled()
            state['session']['uploads'] = [{'id': 'old', 'name': 'expired.json', 'status': 'expired', 'size': 2, 'warnings': ['原文件已过期，请重新上传'], 'previewUrl': '/expired/preview', 'downloadUrl': '/expired/file'}]
            page.locator('#refresh-session').click()
            expect(page.locator('#uploads')).to_contain_text('已过期，请重传')
            assert page.locator('#uploads a').count() == 0
            expect(page.locator('#upload-files')).to_be_enabled()
            page.locator('#upload-files').click()
            expect(page.locator('#assistant-error')).to_contain_text('选择文件')
            page.locator('#assistant-files').set_input_files({'name': 'sample.json', 'mimeType': 'application/json', 'buffer': b'{}'})
            page.locator('#upload-files').click()
            expect(page.locator('#uploads')).to_contain_text('sample.json')
            assert not any(call[1].endswith('/preview') for call in state['calls'])
            page.locator('#uploads > article > details > summary').click()
            expect(page.locator('#uploads')).to_contain_text('来源读取暂时失败')
            state['previewFail'] = False
            page.get_by_role('button', name='重试读取原文').click()
            page.locator('.ta-source-section > summary').click()
            expect(page.locator('#uploads')).to_contain_text('原文保留')
            expect(page.locator('#uploads img')).to_have_attribute('loading', 'lazy')
            expect(page.locator('#uploads img')).to_have_attribute('src', base + '/api/v1/teacher-assistant/uploads/file/assets/page-1.png')
            state['fail'] = True
            page.locator('#assistant-message').fill('习题课，免费给教师和学员，仅回忆归纳，独立副本')
            page.locator('#send-message').click()
            expect(page.locator('#assistant-error')).to_contain_text('模型暂时不可用')
            expect(page.locator('#assistant-message')).to_have_value('习题课，免费给教师和学员，仅回忆归纳，独立副本')
            state['fail'] = False
            page.locator('#send-message').click()
            expect(page.locator('#assistant-message')).to_have_value('')
            for content in ['第 3 题不要', '保留第 3 题，名称加进度']:
                page.locator('#assistant-message').fill(content)
                page.locator('#send-message').click()
                expect(page.locator('#messages')).to_contain_text(content)
                expect(page.locator('#send-message')).to_be_enabled()
            expect(page.locator('#plan-preview')).to_contain_text('方案版本 4')
            expect(page.locator('.ta-downloads a').nth(0)).to_have_attribute('href', base + '/api/v1/teacher-assistant/sessions/one/export?format=json')
            expect(page.locator('.ta-downloads a').nth(1)).to_have_attribute('href', base + '/api/v1/teacher-assistant/sessions/one/export?format=report')
            for download_index in [0, 1]:
                with page.expect_download() as download:
                    page.locator('.ta-downloads a').nth(download_index).click()
                assert download.value.suggested_filename.endswith('.json'), download.value.suggested_filename
                assert json.loads(Path(download.value.path()).read_text())['settings']['duplicatePolicy'] == 'keep_copy'
            page.locator('.ta-question > summary').click()
            expect(page.locator('.ta-question')).to_contain_text('保留关联')
            expect(page.locator('.ta-question .ta-option').first).to_contain_text('A. 甲')
            expect(page.locator('.ta-question .ta-answer')).to_contain_text('答案：A、B')
            expect(page.locator('.ta-publication-state')).to_contain_text('私有草稿')
            expect(page.locator('.ta-question')).to_contain_text('AI 补充')
            assert page.locator('#plan-preview script').count() == 0
            expect(page.locator('#confirm-source-review')).to_be_visible()
            page.locator('#confirm-source-review').click()
            expect(page.locator('#messages')).to_contain_text('我已逐题核对原文、答案和图表')
            expect(page.locator('#send-message')).to_be_enabled()
            state['session']['plan']['blockers'] = ['缺少可靠答案']
            page.locator('#refresh-session').click()
            expect(page.locator('#execute-plan')).to_be_disabled()
            expect(page.locator('#plan-preview')).to_contain_text('缺少可靠答案')
            state['session']['plan']['blockers'] = []
            page.locator('#refresh-session').click()
            expect(page.locator('#execute-plan')).to_be_enabled()
            page.locator('#execute-plan').click()
            expect(page.locator('#cancel-job')).to_be_visible()
            expect(page.locator('#send-message')).to_be_disabled()
            detail_before = sum(call[1] == 'teacher-assistant/sessions/one' for call in state['calls'])
            state['statusFail'] = 1
            page.wait_for_timeout(2100)
            expect(page.locator('#assistant-error')).to_contain_text('网络连接暂时中断')
            page.wait_for_timeout(2100)
            expect(page.locator('#assistant-error')).not_to_be_visible()
            assert any(call[1].endswith('/status') for call in state['calls'])
            assert sum(call[1] == 'teacher-assistant/sessions/one' for call in state['calls']) == detail_before
            page.locator('#cancel-job').click()
            expect(page.locator('#retry-job')).to_be_visible()
            page.locator('#retry-job').click()
            expect(page.locator('#execution-receipt')).to_contain_text('actual-bank')
            expect(page.locator('#execution-receipt')).to_contain_text('第二份材料待核对')
            assert page.locator('#execution-receipt a').count() == 2
            assert state['execute'] == 1
            page.reload()
            expect(page.locator('#execution-receipt')).to_contain_text('actual-bank')
            state['session']['job'] = {'id': 'revision-job', 'kind': 'message', 'status': 'succeeded'}
            state['session']['revision'] += 1
            page.locator('#refresh-session').click()
            expect(page.locator('#job-status')).to_contain_text('预览已更新')
            expect(page.locator('#execute-plan')).to_be_enabled()
            expect(page.locator('#execution-receipt')).to_contain_text('上一版本')
            expect(page.locator('.ta-publication-state')).to_contain_text('私有草稿')
            page.set_viewport_size({'width': 390, 'height': 844})
            expect(page.locator('#preview-panel')).not_to_be_visible()
            page.locator('#tab-preview').click()
            expect(page.locator('#preview-panel')).to_be_visible()
            expect(page.locator('#conversation-panel')).not_to_be_visible()
            page.locator('#tab-conversation').click()
            expect(page.locator('#conversation-panel')).to_be_visible()
            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('#delete-session').click()
            expect(page.locator('#delete-session')).to_be_disabled()
            page.locator('#new-session').click()
            expect(page.locator('#delete-session')).to_be_enabled()
            state['role'] = 'student'
            page.reload()
            expect(page.locator('#assistant-error')).to_contain_text('仅供已登录的教师和管理员')
            expect(page.locator('#new-session')).to_be_disabled()
            browser.close()
            print('PASS: upload/validation, 3-turn revisions, network recovery, source/answer preview, blockers, execute/cancel/retry, receipt/reload, mobile tabs, CRUD, role gate')
    finally:
        server.shutdown()

if __name__ == '__main__':
    run()
