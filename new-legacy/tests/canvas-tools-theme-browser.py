#!/usr/bin/env python3
"""Actual API/pages, authoritative sources overlaid in memory; no release writes."""
import argparse,json,re
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from playwright.sync_api import sync_playwright,expect
from helpers.dialog_actions import respond_dialog
ROOT=Path(__file__).resolve().parents[2];SRC=ROOT/'new-legacy';OUT=ROOT/'artifacts/ui-polish-20261020'
p=argparse.ArgumentParser();p.add_argument('--base-url',required=True);p.add_argument('--source',action='store_true');a=p.parse_args();assert urlparse(a.base_url).hostname in ['localhost','127.0.0.1'];OUT.mkdir(parents=True,exist_ok=True)
groups={g['name']:g for g in json.loads((ROOT/'frontend/scripts/homepage-bundles.json').read_text())['groups']}
def asset(rel):
 for parent in [SRC,ROOT/'frontend/scripts/new-legacy-assets',ROOT/'frontend/public/new-legacy']:
  file=parent/rel
  if file.is_file():return file
 raise AssertionError(rel)
def overlay(route):
 rel=urlparse(route.request.url).path.lstrip('/')
 if rel.startswith('api/'):route.continue_();return
 if rel.startswith('bundles/'):
  name,ext=rel.rsplit('/',1)[1].rsplit('.',1)
  if name in groups:
   files=groups[name]['scripts' if ext=='js' else 'styles'];route.fulfill(body='\n;\n'.join(asset(f).read_text() for f in files),content_type='text/javascript' if ext=='js' else 'text/css');return
 if rel.endswith('.html'):
  response=route.fetch();html=response.text()
  html=html.replace('<head>','<head><link rel="stylesheet" href="styles/dialogs.css"><link rel="stylesheet" href="styles/canvas-toolbar.css"><script src="src/00-dialogs.js"></script>')
  html=re.sub(r'(<script[^>]*src="src/canvas/94-canvas-ink.js[^>]*>)',r'<script defer src="src/canvas/toolbar.js"></script>\1',html)
  route.fulfill(response=response,body=html);return
 if rel.startswith(('src/','styles/','assets/')) and (SRC/rel).is_file():route.fulfill(path=str(SRC/rel));return
 if '/' not in rel and rel.endswith('.js') and (ROOT/'frontend/scripts/new-legacy-assets'/rel).is_file():route.fulfill(path=str(ROOT/'frontend/scripts/new-legacy-assets'/rel));return
 route.continue_()
results=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(channel='chrome')
 for width in [1440,390,320]:
  c=browser.new_context(viewport={'width':width,'height':900},has_touch=width<700)
  assert c.request.post(a.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'}).ok
  if a.source:c.route('**/*',overlay)
  page=c.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_viewport_size({'width':1440,'height':900});page.goto(a.base_url+'/index.html',wait_until='networkidle')
  # Actual releases show the first-visit learning chooser before canvas tools are usable.
  chooser=page.locator('#learningEntryModal.show')
  if chooser.is_visible():
   chooser.locator('[data-learning-entry=graph]').click();expect(chooser).to_be_hidden()
  page.wait_for_function("typeof openRelatedCanvasModal==='function'")
  page.evaluate("""() => {state.nodes=[{id:'r1',title:'相关知识',x:0,y:0,width:220,height:160},{id:'r2',title:'临时卡片',x:360,y:0,width:220,height:160}];state.links=[{id:'rl',from:'r1',to:'r2'}];state.selectedNodeId='r1';openRelatedCanvasModal(false)}""")
  pen=page.locator('.related-canvas-header [data-action=ink]');expect(pen).to_be_visible();page.set_viewport_size({'width':width,'height':900})
  assert pen.locator('svg').evaluate('e=>{const r=e.getBoundingClientRect();return r.width>=16&&r.height>=16&&getComputedStyle(e).stroke!=="none"}'),'temporary pen icon must be visible and stroked'
  (pen.tap() if width<700 else pen.click());expect(page.locator('.related-canvas-backdrop .canvas-ink-toolbar')).to_be_visible()
  for selector in ['[data-ink-tool=select]','[data-ink-tool=pen]','[data-ink-tool=text]','[data-ink-action=undo]']:
   button=page.locator('.related-canvas-backdrop .canvas-ink-toolbar '+selector);expect(button).to_be_visible();assert button.evaluate('e=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}'),selector
  page.screenshot(path=str(OUT/f'related-tools-{width}.png'));page.locator('.related-canvas-header [data-action=close]').click()
  wid='theme-ui-'+uuid4().hex[:10];node={'id':'sample','questionId':'ink-question-2','bankId':'ink-bank','paperId':'ink-paper','releaseId':'ink-release','title':'整卡主题','x':120,'y':120,'width':580,'height':500,'color':'#ffffff'}
  note={'id':'note','nodeType':'synthesis-card','title':'归纳原则','content':'先分析影响，再采取措施。','x':760,'y':120,'width':480,'height':300,'color':'#ffffff','synthesisType':'principle','status':'draft','tags':[],'sourceNodeIds':[]}
  payload={'id':wid,'userId':'ink-browser','title':'主题与工具回归','schemaVersion':10,'nodes':{'sample':node,'note':note},'edges':[],'groups':[],'strokes':[],'tables':[]}
  assert c.request.post(a.base_url+'/api/v1/workspaces',data={'id':wid,'title':payload['title'],'schemaVersion':10,'payload':payload}).ok
  for kind,url,card in [('workspace','/question-workspace.html?paperId=ink-paper&releaseId=ink-release&workspace='+wid,'.qw-question-card'),('recall','/knowledge-recall.html?paperId=ink-paper&releaseId=ink-release&questionId=ink-question-2&bankId=ink-bank','.kr-question-card')]:
   page.goto(a.base_url+url,wait_until='networkidle');expect(page.locator(card).first).to_be_visible();page.wait_for_timeout(700)
   if kind=='workspace':before=page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')
   summary=page.locator('[data-learning-theme-menu]>summary');summary.click();page.locator('[data-kr-theme=neon]').click()
   page.screenshot(path=str(OUT/f'{kind}-neon-{width}.png'))
   surface=page.locator(card).first.evaluate('e=>getComputedStyle(e).backgroundColor');assert surface!='rgb(255, 255, 255)',surface
   # The real stem has its own CSS color; changing only the card surface can
   # leave dark text on a dark theme even when the outer card is correct.
   for theme in ['neon','parchment','aurora','sakura','ocean','latte']:
    page.locator('button[data-kr-theme='+theme+']').click()
    contrasts=page.locator(card).evaluate_all("""cards=>{
      const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      return cards.flatMap(card=>[...card.querySelectorAll('.qw-card-question-stem,.kr-stem,.qw-card-option-copy,.qw-synthesis-content,.qw-synthesis-principle,.qw-bilingual-en')]).filter(e=>e.textContent.trim()).map(e=>{
        let parent=e,bg;
        while(parent){bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]>=.99)break;parent=parent.parentElement}
        const fg=rgb(getComputedStyle(e).color),a=lum(fg),b=lum(bg);
        return {selector:e.className,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      });
    }""")
    assert contrasts and (kind!='workspace' or any(item['selector']=='qw-synthesis-content' for item in contrasts)) and all(item['ratio']>=4.5 for item in contrasts),(kind,width,theme,contrasts)
   page.locator('[data-learning-theme-panel] button').filter(has_text='取消').click()
   summary.click();page.locator('[data-kr-theme=ocean]').click();page.locator('[data-theme-save]').click()
   page.reload(wait_until='networkidle');expect(page.locator('#qwThemeSelect' if kind=='workspace' else '#krThemeSelect')).to_have_value('ocean')
   if kind=='workspace':assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().background')==before
   summary=page.locator('[data-learning-theme-menu]>summary');summary.click();assert page.locator('[data-learning-theme-panel]').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}')
   page.screenshot(path=str(OUT/f'{kind}-theme-{width}.png'));page.keyboard.press('Escape');assert not page.locator('[data-learning-theme-menu]').evaluate('e=>e.open')
   launcher=page.locator('#qwInkBtn' if kind=='workspace' else '#krInkBtn')
   if kind=='workspace' and width<700:
    expect(launcher).to_be_disabled();page.screenshot(path=str(OUT/f'{kind}-tools-{width}.png'));continue
   launcher.click();expect(page.locator('.canvas-ink-toolbar')).to_be_visible();page.screenshot(path=str(OUT/f'{kind}-tools-{width}.png'))
   page.locator('.canvas-ink-toolbar [data-ink-tool=pen]').click()
   if width<700:
    touch=c.new_cdp_session(page);touch.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':100,'y':460}]})
    for x in [120,140,160]:touch.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':470}]})
    touch.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});touch.detach()
   else:
    page.mouse.move(800,450);page.mouse.down();page.mouse.move(880,480,steps=8);page.mouse.up()
   expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
   page.locator('.canvas-ink-toolbar [data-ink-action=undo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
   page.locator('.canvas-ink-toolbar [data-ink-action=redo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
   if kind=='workspace':page.evaluate('KGCanvasWorkspaceAdapter.flush({throwOnError:true})')
   else:assert page.evaluate("KGLearningProgress.flush('deep_recall')") is True
   page.reload(wait_until='networkidle');expect(page.locator('.canvas-ink-layer path')).to_have_count(1)
   if kind=='workspace' and width==1440:
    active=page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')
    page.locator('#qwCreateWorkspaceBtn').click();respond_dialog(page,'请输入画布名称',accept=False);assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')==active
    page.locator('#qwCreateWorkspaceBtn').click();respond_dialog(page,'请输入画布名称',text='异步画布创建');page.wait_for_function("KGMultiQuestionWorkspace.activeWorkspace()?.title==='异步画布创建'")
    current=page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()');assert current!=active
    page.evaluate('void KGMultiQuestionWorkspace.renameWorkspace()');respond_dialog(page,'请输入新的画布名称',text='异步重命名');page.wait_for_function("KGMultiQuestionWorkspace.activeWorkspace()?.title==='异步重命名'")
    page.evaluate('void KGMultiQuestionWorkspace.deleteWorkspace()');respond_dialog(page,'删除当前多题画布',accept=False);assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspaceId()')==current
    page.evaluate('void KGMultiQuestionWorkspace.deleteWorkspace()');respond_dialog(page,'删除当前多题画布');page.wait_for_function('(old)=>KGMultiQuestionWorkspace.activeWorkspaceId()!==old',arg=current)
   # Each viewport receives fresh recall ink, so the next iteration can assert exact history counts.
   if kind=='recall':
    page.locator('#krInkBtn').click();page.locator('.canvas-ink-toolbar [data-ink-tool=eraser]').dblclick();assert page.evaluate("KGLearningProgress.flush('deep_recall')") is True

  assert not errors,errors;results.append({'width':width,'touch':width<700,'checks':'temporary icon/tools, shared whole-card preview/cancel/save/reload, independent background, theme bounds, Escape, both ink toolbars','pageErrors':errors});c.close();print('PASS',width,flush=True)
 browser.close()
(OUT/'canvas-tools-theme-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
