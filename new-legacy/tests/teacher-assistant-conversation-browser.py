#!/usr/bin/env python3
"""Real browser UI with deterministic mock transport; never proof of model output."""
import copy,json,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'artifacts'/'assistant-v2';OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT),**k)
    def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
def session(id):return dict(id=id,title='新对话' if id=='a' else '另一段对话',revision=0,messages=[],uploads=[],plan=None,job=None,receipt=None,stream={'text':'','lastEventId':0},runtime={'status':'idle'})
sessions={'a':session('a'),'b':session('b')};calls=[];state={'uploadFail':False,'messageFail':False,'emptyUploads':False,'resync':False,'streamMode':'complete','activated':False,'activation409':0,'failLoad':0,'failEvents':0,'uploadLost':False}
def api(route):
    r=route.request;path=r.url.split('/api/v1/')[-1];calls.append((r.method,path));body={};status=200
    if path=='auth/me':body={'user':{'username':'测试教师','role':'teacher'}}
    elif path=='teacher-assistant/sessions':
        if r.method=='POST':sessions['c']=session('c');body={'session':sessions['c']}
        else:body={'sessions':list(sessions.values())}
    else:
        bits=path.split('/');sid=bits[2];s=sessions[sid];action=bits[3].split('?')[0] if len(bits)>3 else ''
        if action=='activate':
            if state['activation409']:state['activation409']-=1;status=409;body={'detail':'正在停止上一段对话'}
            else:state['activated']=True;body={'session':s}
        elif action=='uploads':
            if state['uploadFail']:status=503;body={'detail':'文件上传失败，请重试'}
            else:
                if not state['emptyUploads']:s['uploads'].append({'id':str(len(s['uploads'])+1),'name':'lesson.png','size':3,'status':'uploaded'})
                body={'session':s}
                if state['uploadLost']:state['uploadLost']=False;route.abort('failed');return
        elif action=='messages':
            assert state['activated']; assert not state['emptyUploads']
            if state['messageFail']:status=503;body={'detail':'暂时不可用，请重试'}
            else:
                s['messages'].append({'role':'user','content':r.post_data_json['content']});s['job']={'id':'job'+str(len(s['messages'])),'status':'running','kind':'message'};s['stream']={'text':'','lastEventId':0};body={'session':s}
        elif action=='events':
            if state['failEvents']:
                state['failEvents']-=1;route.abort('failed');return
            after=int(r.url.split('after=')[-1]);jid=s['job']['id']
            if state['resync']:
                s['stream']={'jobId':jid,'text':'从快照恢复的回复','lastEventId':20};state['resync']=False
                events=[{'id':20,'jobId':jid,'type':'status','data':{'status':'resync_required'}}]
            elif state['streamMode']=='hold':
                events=[{'id':21,'jobId':jid,'type':'text_delta','data':{'text':'逐步回复'}}] if after<21 else []
                if after<21:s['stream']={'jobId':jid,'text':s['stream']['text']+'逐步回复','lastEventId':21}
            else:
                events=[{'id':30,'jobId':jid,'type':'tool_start','data':{'label':'读取教学材料'}},{'id':31,'jobId':jid,'type':'tool_end','data':{'label':'读取教学材料','ok':True}},{'id':32,'jobId':jid,'type':'text_delta','data':{'text':'已阅读材料，接下来可以一起讨论。'}},{'id':33,'jobId':jid,'type':'done','data':{'status':'succeeded'}}]
                s['messages'].append({'role':'assistant','content':'已阅读材料，接下来可以一起讨论。'});s['job']['status']='succeeded';s['stream']={'text':'','lastEventId':33}
            route.fulfill(status=200,content_type='text/event-stream',body=''.join('id: '+str(e['id'])+'\ndata: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events));return
        elif action=='retry':s['job']['status']='running';s['job'].pop('error',None);body={'session':s}
        elif action=='cancel':s['job']['status']='cancelled';s['runtime']['status']='idle';body={'session':s}
        else:
            if state['failLoad']:
                state['failLoad']-=1;route.abort('failed');return
            body={'session':s}
    route.fulfill(status=status,content_type='application/json',body=json.dumps(body,ensure_ascii=False))
try:
 with sync_playwright() as p:
    browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':1000});context.route('**/api/v1/**',api);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/teacher-assistant.html?session=a');expect(page.locator('#send-message')).to_be_enabled();page.screenshot(path=str(OUT/'mock-conversation-empty-1440.png'))
    # File immediately appears, no request until send; failed upload retains everything.
    page.locator('#assistant-files').set_input_files({'name':'lesson.png','mimeType':'image/png','buffer':b'123'});expect(page.locator('#pending-files')).to_contain_text('lesson.png');assert not any(path.endswith('/uploads') for _,path in calls)
    page.locator('#assistant-message').fill('请看看这张图片');state['uploadFail']=True;page.locator('#send-message').click();expect(page.locator('#assistant-error')).to_contain_text('文件上传失败');expect(page.locator('#assistant-message')).to_have_value('请看看这张图片');assert not any(path.endswith('/messages') for _,path in calls)
    state['uploadFail']=False;state['emptyUploads']=True;page.locator('#send-message').click();expect(page.locator('#assistant-error')).to_contain_text('尚未确认');assert not any(path.endswith('/messages') for _,path in calls)
    state['emptyUploads']=False;state['uploadLost']=True;page.locator('#send-message').click();expect(page.locator('#assistant-error')).to_contain_text('网络连接暂时中断');expect(page.locator('#pending-files')).to_contain_text('已上传');upload_count=sum(path.endswith('/uploads') for _,path in calls)
    state['messageFail']=True;page.locator('#send-message').click();expect(page.locator('#assistant-error')).to_contain_text('暂时不可用');expect(page.locator('#pending-files')).to_contain_text('已上传');count=sum(path.endswith('/uploads') for _,path in calls)
    assert sum(path.endswith('/uploads') for _,path in calls)==upload_count
    state['messageFail']=False;page.locator('#send-message').click();expect(page.locator('#messages')).to_contain_text('已阅读材料');expect(page.locator('#pending-files')).to_be_empty();assert sum(path.endswith('/uploads') for _,path in calls)==count
    assert next(i for i,c in enumerate(calls) if c[1].endswith('/uploads'))<next(i for i,c in enumerate(calls) if c[1].endswith('/messages'))
    for text in ['帮我梳理重点','用更简洁的话解释']:
        expect(page.locator('#send-message')).to_be_enabled();page.locator('#assistant-message').fill(text);page.locator('#send-message').click();expect(page.locator('#messages .assistant')).to_have_count(2 if text=='帮我梳理重点' else 3)
    page.screenshot(path=str(OUT/'mock-conversation-1440.png'));page.reload();expect(page.locator('#messages .assistant')).to_have_count(3)
    # Activation waits for old process, selected session cannot send early.
    state['activation409']=2;page.locator('[data-session-id="b"]').click();expect(page.locator('#send-message')).to_be_disabled();expect(page.locator('[data-session-id="b"]')).to_have_attribute('aria-current','true');expect(page.locator('#messages')).to_be_empty();expect(page.locator('#send-message')).to_be_enabled()
    page.locator('[data-session-id="a"]').click();expect(page.locator('#messages .assistant')).to_have_count(3)
    # Retention reset reloads snapshot then reconnects using its atomic cursor.
    state['streamMode']='hold';state['resync']=True;page.locator('#assistant-message').fill('继续分析');page.locator('#send-message').click();expect(page.locator('#stream-text')).to_contain_text('从快照恢复的回复逐步回复');assert any('after=20' in path for _,path in calls)
    state['failLoad']=1;state['failEvents']=1
    expect(page.locator('#assistant-error')).to_contain_text('网络连接暂时中断',timeout=12000)
    expect(page.locator('#assistant-error')).not_to_be_visible(timeout=12000)
    expect(page.locator('#stream-text')).to_have_text('从快照恢复的回复逐步回复')
    page.locator('#stop-message').click();expect(page.locator('#send-message')).to_be_enabled();assert any(path.endswith('/cancel') for _,path in calls)
    sessions['a']['job']['status']='failed';sessions['a']['job']['error']='模型处理暂时失败';page.locator('#refresh-session').click();expect(page.locator('#conversation-result')).to_contain_text('模型处理暂时失败');page.get_by_role('button',name='重试这次处理').click();expect(page.locator('#stop-message')).to_be_visible();assert any(path.endswith('/retry') for _,path in calls);page.locator('#stop-message').click();expect(page.locator('#send-message')).to_be_enabled()
    # Mobile: drawer, no overflow, pending attachment removal and IME Enter.
    page.set_viewport_size({'width':390,'height':844});page.keyboard.press('Escape');page.locator('#toggle-sidebar').click();expect(page.locator('#sidebar')).to_be_visible();page.keyboard.press('Escape');expect(page.locator('#sidebar')).not_to_be_visible()
    page.locator('#assistant-files').set_input_files({'name':'lesson.png','mimeType':'image/png','buffer':b'123'});page.get_by_role('button',name='移除 lesson.png').click();expect(page.locator('#pending-files')).to_be_empty()
    page.locator('#assistant-message').evaluate("el => {const data=new DataTransfer();data.items.add(new File(['123'],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));}")
    expect(page.locator('#pending-files')).to_contain_text('pasted.png');page.get_by_role('button',name='移除 pasted.png').click()
    page.locator('#assistant').evaluate("el => {const data=new DataTransfer();data.items.add(new File(['123'],'dropped.png',{type:'image/png'}));el.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true}));}")
    expect(page.locator('#pending-files')).to_contain_text('dropped.png');page.get_by_role('button',name='移除 dropped.png').click()
    before=len(calls);page.locator('#assistant-message').fill('输入法确认');page.locator('#assistant-message').dispatch_event('keydown',{'key':'Enter','isComposing':True});assert len(calls)==before
    assert page.evaluate('document.documentElement.scrollWidth')==390
    page.screenshot(path=str(OUT/'mock-conversation-390.png'))
    # Another real browser tab reads server snapshot; no business browser storage.
    tab=context.new_page();tab.goto(base+'/teacher-assistant.html?session=b');expect(tab.locator('#send-message')).to_be_enabled();expect(tab.locator('#messages')).to_be_empty()
    assert not errors,errors
    browser.close();print('PASS: ordered attachments / failures / empty server files / no duplicate retry / SSE / 3 turns / A-B activate / resync / stop / reload / multi-tab / IME / mobile390; mocked transport, real DOM')
finally:server.shutdown()
