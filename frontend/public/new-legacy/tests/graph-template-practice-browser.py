"""T16 combined flow: template copy -> cross-file paste inherits grants -> drawer practice."""
import argparse,json
from uuid import uuid4
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);args=parser.parse_args();base=args.base_url.rstrip('/')
    assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t16';out.mkdir(parents=True,exist_ok=True)
    fixture=json.loads((ROOT/'artifacts/canvas-m2-m5/t15/fixture.json').read_text())
    users=fixture['users'];password=fixture['password'];errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome');ctx=browser.new_context(viewport={'width':1440,'height':900})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':users['teacher'],'password':password}).ok
        # 教师：把带会员题绑定的源图谱发布为免费模板。
        revision=ctx.request.get(base+'/api/v1/files/'+fixture['files']['teacher']).json()['meta']['revision']
        published=ctx.request.post(base+'/api/v1/graph-templates',data={'sourceFileId':fixture['files']['teacher'],'expectedFileRevision':revision,'name':'T16 免费模板','description':'跨文件复制继承验证','memberOnly':False}).json()['template']
        assert ctx.request.post(base+'/api/v1/auth/logout').ok
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':users['student'],'password':password}).ok
        # 非会员学生：加载免费模板（含会员题冻结绑定）得到私有副本。
        catalog=ctx.request.get(base+'/api/v1/graph-templates').json()['templates']
        loaded=ctx.request.post(base+f"/api/v1/graph-templates/{published['id']}/loads",data={'version':published['version'],'requestId':'t16-'+uuid4().hex}).json()
        copy_id=loaded['fileId'];nid=loaded['idMap']['n']
        copy=ctx.request.get(base+'/api/v1/files/'+copy_id).json()
        second=ctx.request.post(base+'/api/v1/files',data={'name':'T16 粘贴目标','graphData':{'nodes':[],'links':[]}}).json()['file']
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':copy_id}).ok
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'/index.html',wait_until='networkidle');page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
            if page.locator(selector).is_visible():page.locator(selector).click()
        # 真实键盘复制带题卡片，切到第二个文件后粘贴：应走服务端受控端点并继承题目。
        page.locator(f'.knowledge-card[data-node-id="{nid}"]').click()
        page.keyboard.press('Meta+c')
        fragment=page.evaluate('KGGraphKernel.clipboard.readFragment()')
        assert fragment['nodes'] and fragment['source']['fileId']==copy_id,fragment
        page.locator('.graph-file-tab[data-file-id="'+second['id']+'"]').click()
        page.wait_for_function('state.nodes.length===0 && !KGGraphFileTabs.isSwitching()')
        revision_before=ctx.request.get(base+'/api/v1/files/'+second['id']).json()['meta']['revision']
        page.evaluate("""()=>{const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented}""")
        page.wait_for_function('state.nodes.length===1')
        new_id=page.evaluate('state.nodes[0].id')
        assert new_id!=nid
        # 服务端已写入：文件 revision 前进、图数据包含新卡，且本地无 autosave 冲突。
        page.wait_for_timeout(800)
        remote=ctx.request.get(base+'/api/v1/files/'+second['id']).json()
        assert remote['graphData']['nodes'][0]['id']==new_id and remote['meta']['revision']>revision_before
        assert remote['graphData']['nodes'][0]['content']['notes']==copy['graphData']['nodes'][0]['content']['notes']
        bindings=ctx.request.get(base+f"/api/v1/graph-questions/files/{second['id']}/nodes/{new_id}/bindings").json()['bindings']
        assert len(bindings)==1 and bindings[0]['question']['title']
        # 新卡抽屉可作答并看解析（继承授权，非会员可用）。
        page.locator(f'.knowledge-card[data-node-id="{new_id}"]').click()
        practice=page.locator('#graphPracticeBtn')
        page.evaluate("document.querySelector('#detailPanel').scrollTop=999999")
        page.wait_for_timeout(200)
        practice.click()
        expect(page.locator('.gqd-question')).to_have_count(1)
        page.locator('.gqd-question input[value=A]').check()
        page.locator('.gqd-question [data-submit]').click()
        expect(page.locator('.gqd-analysis')).to_be_visible()
        expect(page.locator('[data-feedback]')).to_contain_text('回答正确')
        page.screenshot(path=str(out/'cross-file-paste-practice.png'))
        page.locator('[data-close]').click()
        # 客户端自带 questionIds 被剥离；授权只来自服务端真实来源绑定。
        forged=json.loads(json.dumps(fragment));forged['nodes'][0]['questionIds']=['forged-q']
        r=ctx.request.post(base+f"/api/v1/files/{second['id']}/fragments",data={'fragment':forged})
        assert r.status==200,r.text
        forged_id=r.json()['idMap'][nid]
        forged_node=ctx.request.get(base+'/api/v1/files/'+second['id']).json()['graphData']['nodes']
        assert all('questionIds' not in n for n in forged_node)
        assert len(ctx.request.get(base+f"/api/v1/graph-questions/files/{second['id']}/nodes/{forged_id}/bindings").json()['bindings'])==1
        # 来源 revision 过期 -> 409，目标无半成品。
        stale=json.loads(json.dumps(fragment));stale['source']['revision']=copy['meta']['revision']-1
        r=ctx.request.post(base+f"/api/v1/files/{second['id']}/fragments",data={'fragment':stale})
        assert r.status==409 and r.json()['detail']['code']=='GRAPH_FRAGMENT_SOURCE_STALE'
        assert len(ctx.request.get(base+'/api/v1/files/'+second['id']).json()['graphData']['nodes'])==2
        # 普通会员试卷入口仍拒绝非会员（卡片例外不外溢）。
        assert ctx.request.get(base+f"/api/v1/paper-releases/{users['release']}/questions").status==404
        assert not errors,errors
        browser.close();print('PASS: template copy -> cross-file paste inherits grant; forged ids rejected; stale source 409; drawer practice')
if __name__=='__main__':main()
