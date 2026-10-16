"""Actual teacher bulk matching, preview/subset/append/reload and recovery on isolated DB."""
import argparse,json,uuid
from pathlib import Path
from helpers.graph_detail_actions import assert_reduced_detail_actions, open_retained_practice
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);base=p.parse_args().base_url.rstrip('/');assert base.startswith('http://127.0.0.1:')
OUT=ROOT/'artifacts/practice-feedback-graph-bulk';OUT.mkdir(exist_ok=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True);ctx=browser.new_context(viewport={'width':1440,'height':1000})
    def call(method,path,body=None):
        r=getattr(ctx.request,method)(base+path,data=body) if body is not None else getattr(ctx.request,method)(base+path)
        assert r.ok,(path,r.status,r.text());return r.json()
    call('post','/api/v1/auth/login',{'username':'ink-browser','password':'ink-browser-test'})
    term='风险响应'+uuid.uuid4().hex[:7]
    bank=call('post','/api/v1/banks',{'name':term,'subject':'PMP','visibility':'private'})['bank'];questions=[]
    for i in range(2):questions.append(call('post',f'/api/v1/banks/{bank["id"]}/questions',{'title':term+str(i),'subject':'PMP','type':'single_choice','stemParts':[{'text':term+'识别风险后先分析影响。'}],'options':[{'id':'A','text':'分析'},{'id':'B','text':'忽略'}],'correctAnswer':'A','analysis':'先分析再响应。','metadata':{'subjectFacets':[{'dimensionId':'exam-domain','valueId':'process'}]}})['question']['id'])
    acp_bank=call('post','/api/v1/banks',{'name':term+' ACP','subject':'PMI-ACP','visibility':'private'})['bank']
    acp_question=call('post',f'/api/v1/banks/{acp_bank["id"]}/questions',{'title':term+' ACP','subject':'PMI-ACP','type':'single_choice','stemParts':[{'text':term+'敏捷问题'}],'options':[{'id':'A','text':'分析'},{'id':'B','text':'忽略'}],'correctAnswer':'A','analysis':'分析','metadata':{}})['question']['id']
    file=call('post','/api/v1/files',{'name':'批量配题回归','graphData':{'meta':{'subject':'PMI-ACP / 敏捷项目管理'},'nodes':[{'id':'a','title':term,'x':200,'y':200},{'id':'b','title':'关联卡片','keywords':term,'x':550,'y':200},{'id':'none','title':'未匹配'+uuid.uuid4().hex,'x':350,'y':500}],'links':[]}})['file']['id']
    single=f'/api/v1/graph-questions/files/{file}/nodes/'
    call('put',single+'a/bindings',{'expectedFileRevision':1,'questionIds':[questions[0]]});call('put','/api/v1/files/current',{'fileId':file})
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def ready():
        page.goto(base+'/index.html',wait_until='networkidle')
        for s in ['#learningEntryDismissBtn','.tour-skip','#hideHelpBtn']:
            if page.locator(s).is_visible():page.locator(s).click()
        page.wait_for_function('!!window.KGGraphFileTabs')
    ready();page.evaluate("selectedNodeIds.clear();state.selectedNodeId='a';renderDetails()")
    assert_reduced_detail_actions(page)
    page.locator('#detailActionsToggle').click()
    expect(page.locator('#editFromDetailBtn')).to_be_visible()
    expect(page.locator('#deleteNodeFromDetailBtn')).to_be_visible()
    page.screenshot(path=str(OUT/'detail-actions-reduced-desktop.png'))
    page.locator('#editFromDetailBtn').click();expect(page.locator('#nodeModal')).to_be_visible()
    page.locator('#cancelNodeBtn').click();expect(page.locator('#nodeModal')).to_be_hidden()
    for locked in [True, False]:
        page.evaluate("locked=>{nodeById('a').interaction={locked};renderDetails()}",locked)
        assert_reduced_detail_actions(page)
        assert page.locator('#editFromDetailBtn').is_disabled()==locked
    page.evaluate("state.selectedNodeId=null;hoverDetailNodeId='b';renderDetails()")
    assert_reduced_detail_actions(page)
    page.set_viewport_size({'width':390,'height':844})
    assert_reduced_detail_actions(page)
    page.screenshot(path=str(OUT/'detail-actions-reduced-mobile.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.locator('#closeDetailBtn').click();expect(page.locator('#detailPanel')).to_be_hidden()
    page.evaluate("state.selectedNodeId='a';renderDetails()")
    # Remaining drawer coverage invokes the retained hidden component internally.
    open_retained_practice(page);drawer=page.get_by_role('complementary',name='卡片做题');expect(drawer).to_be_visible()
    button=page.get_by_role('button',name='批量添加题目',exact=True);expect(button).to_be_visible();button.click();expect(drawer).to_be_hidden()
    modal=page.get_by_role('dialog',name='批量添加题目');expect(modal).to_be_visible()
    expect(modal.get_by_label('每张卡片新增题数')).to_have_value('3')
    expect(modal.get_by_label('匹配科目')).to_have_value('PMP')
    expect(modal.get_by_label('匹配科目').locator('option[value="PMI-ACP"]')).to_have_count(1)
    expect(modal.get_by_label('卡片范围')).to_have_value('selected');modal.get_by_label('卡片范围').select_option('all')
    expect(modal.locator('[data-batch-node] input:checked')).to_have_count(3)
    modal.get_by_role('button',name='清空选择',exact=True).click();expect(modal.get_by_role('button',name='预览匹配',exact=True)).to_be_disabled()
    modal.get_by_role('button',name='全选当前列表',exact=True).click()
    modal.get_by_label('搜索知识卡片').fill('关联卡片');expect(modal.locator('[data-batch-node]')).to_have_count(1);modal.get_by_label('搜索知识卡片').fill('')
    modal.get_by_label('每张卡片新增题数').fill('0');expect(modal.get_by_role('button',name='预览匹配',exact=True)).to_be_disabled();modal.get_by_label('每张卡片新增题数').fill('3')
    with page.expect_request('**/batch-preview') as sent:
        modal.get_by_role('button',name='预览匹配',exact=True).click()
    assert sent.value.post_data_json['subject']=='PMP'
    expect(modal.locator('[data-batch-preview-card]')).to_have_count(3)
    expect(modal.locator('[data-batch-preview-card="none"]')).to_contain_text('未找到')
    modal.get_by_label('匹配科目').select_option('PMI-ACP');expect(modal.locator('[data-batch-preview-card]')).to_have_count(0)
    modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card="a"] input')).to_have_count(1)
    assert modal.locator('[data-batch-preview-card="a"] input').get_attribute('value')==acp_question
    modal.get_by_label('匹配科目').select_option('PMP');expect(modal.locator('[data-batch-preview-card]')).to_have_count(0)
    modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card]')).to_have_count(3)
    assert len(call('get',single+'a/bindings')['bindings'])==1,'preview must not write'
    assert len(call('get',single+'b/bindings')['bindings'])==0
    modal.locator('[data-batch-preview-card="b"] input[value="'+questions[1]+'"]').uncheck()
    modal.get_by_role('button',name='确认添加',exact=False).click();expect(modal.locator('[data-batch-status]')).to_contain_text('已添加 2 道题目')
    expect(modal.locator('[data-batch-preview-card]')).to_have_count(0)
    assert len(call('get',single+'a/bindings')['bindings'])==2
    assert len(call('get',single+'b/bindings')['bindings'])==1
    modal.get_by_role('button',name='关闭批量配题').click();open_retained_practice(page);expect(drawer.locator('.gqd-question')).to_have_count(2);drawer.get_by_role('button',name='关闭做题抽屉').click();ready()
    page.evaluate("selectedNodeIds=new Set(['a']);state.selectedNodeId='a';refreshSelectionUI()")
    button.click();modal.get_by_label('卡片范围').select_option('selected');expect(modal.locator('[data-batch-node] input:checked')).to_have_count(1)
    modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card]')).to_have_count(1)
    expect(modal.get_by_role('button',name='确认添加',exact=False)).to_be_disabled()
    # Changing a subject invalidates the signed preview and cannot reuse candidates.
    modal.get_by_label('匹配科目').dispatch_event('change');expect(modal.locator('[data-batch-preview-card]')).to_have_count(0)
    # Failed matching preserves selections and allows retry, never writes.
    page.route('**/batch-preview',lambda route:route.fulfill(status=503,json={'detail':'暂时不可用'}))
    modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-status]')).to_contain_text('暂时不可用')
    page.unroute('**/batch-preview');modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card]')).to_have_count(1)
    # Revision conflicts clear the obsolete preview and preserve all existing bindings.
    modal.get_by_label('卡片范围').select_option('all');modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card]')).to_have_count(3)
    page.route('**/batch-apply',lambda route:route.fulfill(status=409,json={'detail':{'code':'GRAPH_FILE_REVISION_CONFLICT'}}))
    modal.get_by_role('button',name='确认添加',exact=False).click();expect(modal.locator('[data-batch-status]')).to_contain_text('图谱已更新')
    expect(modal.locator('[data-batch-preview-card]')).to_have_count(0);assert len(call('get',single+'b/bindings')['bindings'])==1
    page.unroute('**/batch-apply')
    # Closing cancels a read-only in-flight preview; a late response cannot repopulate it.
    deferred=[];page.route('**/batch-preview',lambda route:deferred.append(route))
    modal.get_by_role('button',name='预览匹配',exact=True).click();page.wait_for_timeout(200);assert deferred
    modal.get_by_role('button',name='关闭批量配题').click();expect(modal).to_be_hidden()
    try:deferred[0].fulfill(status=503,json={'detail':'late response'})
    except Exception:pass
    page.unroute('**/batch-preview');button.click();expect(modal.locator('[data-batch-status]')).to_be_empty();expect(modal.locator('[data-batch-preview-card]')).to_have_count(0)
    # Slow subject lists must remain independent from a preview already in progress.
    modal.get_by_role('button',name='关闭批量配题').click()
    subject_requests=[];page.route('**/graph-questions/subjects',lambda route:subject_requests.append(route))
    button.click();page.wait_for_timeout(200);assert subject_requests
    modal.get_by_role('button',name='预览匹配',exact=True).click();expect(modal.locator('[data-batch-preview-card]').first).to_be_visible()
    try:subject_requests[0].fulfill(status=200,json={'subjects':['PMP','PMI-ACP']})
    except Exception:pass
    expect(modal.get_by_label('匹配科目').locator('option[value="PMI-ACP"]')).to_have_count(1)
    page.unroute('**/graph-questions/subjects');modal.get_by_role('button',name='关闭批量配题').click()
    # Subject service failure keeps the explicit PMP fallback usable; reopening retries.
    page.route('**/graph-questions/subjects',lambda route:route.fulfill(status=503,json={'detail':'暂时不可用'}))
    button.click();expect(modal.locator('[data-batch-status]')).to_contain_text('科目列表读取失败')
    expect(modal.get_by_label('匹配科目')).to_have_value('PMP')
    page.unroute('**/graph-questions/subjects');modal.get_by_role('button',name='关闭批量配题').click();button.click()
    expect(modal.get_by_label('匹配科目').locator('option[value="PMI-ACP"]')).to_have_count(1)
    page.set_viewport_size({'width':800,'height':844});page.wait_for_timeout(200)
    box=modal.bounding_box();assert box['x']>=0 and box['x']+box['width']<=801,box
    assert modal.get_by_role('button',name='预览匹配',exact=True).evaluate("b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.right-8,r.top+r.height/2)?.closest('[role=dialog]')===b.closest('[role=dialog]')}"),'floating navigation covers batch controls'
    page.screenshot(path=str(OUT/'batch-tablet.png'))
    # Existing phone policy forces read-only mode: changing to phone closes edits.
    page.set_viewport_size({'width':390,'height':844});expect(modal).to_be_hidden();expect(button).to_be_hidden()
    page.screenshot(path=str(OUT/'batch-mobile-reading.png'))
    page.set_viewport_size({'width':1440,'height':1000});button.click();page.keyboard.press('Escape');expect(modal).to_be_hidden()
    # Admin is permitted; students and viewers are blocked by the UI as well as API tests.
    view=browser.new_context();assert view.request.post(base+'/api/v1/auth/login',data={'username':'ink-viewer','password':'ink-browser-test'}).ok
    vp=view.new_page();vp.goto(base+'/index.html',wait_until='networkidle');expect(vp.locator('#graphQuestionBatchBtn')).to_be_hidden();view.close()
    assert not errors,errors
    (OUT/'batch-browser-results.json').write_text(json.dumps({'added':2,'previewWrites':0,'roles':'teacher allowed, viewer hidden','checks':['all/selected/custom/search/clear','count validation','subset confirm, preserved existing, reload','zero matches/full card','503 retry','390px/Escape','zero JS errors']},ensure_ascii=False,indent=2))
    browser.close()
print('PASS graph bulk: preview, subsets, preserved existing, API/reload, scopes, recovery, mobile, role')
