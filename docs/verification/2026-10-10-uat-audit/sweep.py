import ast,json,time,datetime,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path.cwd(); OUT=ROOT/'docs/verification/2026-10-10-uat-audit'; BASE='https://uat.aihuanpu.com'
m=ast.parse((ROOT/'backend/tests/test_principle_safe_merge_api.py').read_text()); password=next(ast.literal_eval(n.value) for n in m.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='ADMIN_PASSWORD' for t in n.targets))
routes=['/','/practice-mode.html','/knowledge-recall.html','/question-workspace.html','/graph','/question-training.html','/help-center.html','/multi-question-help.html','/teacher-workbench.html','/teacher-assistant.html','/question-bank.html','/paper-management.html','/file-manager.html','/content-center.html','/admin-console.html','/admin-settings.html','/admin-subjects.html','/admin-operations.html','/user-management.html','/message-management.html','/feedback-management.html','/learning-path.html','/course-admin.html','/system-settings.html','/privacy-policy.html','/terms-of-service.html']
results=[]
try: axe=urllib.request.urlopen('https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.3/axe.min.js',timeout=20).read().decode()
except Exception: axe=None
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True); c=b.new_context(viewport={'width':1440,'height':900}); p=c.new_page();p.set_default_timeout(12000)
 p.goto(BASE+'/login',wait_until='networkidle');p.locator('#authUsername').fill('admin');p.locator('#authPassword').fill(password);p.locator('#authLegalConsent').check();p.get_by_role('button',name='登录',exact=True).click();p.wait_for_timeout(1800)
 print('LOGIN',p.locator('#authStatus').inner_text(),flush=True)
 for route in routes:
  rec={'route':route,'time':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'console':[],'pageErrors':[],'failedResponses':[],'failedRequests':[],'views':[]}
  q=c.new_page();q.set_default_timeout(12000)
  q.on('console',lambda m:rec['console'].append({'type':m.type,'text':m.text}) if m.type in ['error','warning'] else None)
  q.on('pageerror',lambda e:rec['pageErrors'].append(str(e)))
  q.on('response',lambda r:rec['failedResponses'].append({'status':r.status,'url':r.url}) if r.status>=400 else None)
  q.on('requestfailed',lambda r:rec['failedRequests'].append({'url':r.url,'failure':r.failure}))
  name=route.strip('/').replace('.html','') or 'landing'
  try:
   r=q.goto(BASE+route,wait_until='networkidle',timeout=40000);q.wait_for_timeout(650);rec.update(status=r.status,url=q.url,title=q.title(),release=q.locator('html').get_attribute('data-release'))
   rec['controls']=q.locator('button,a,input,select,textarea').evaluate_all('(es)=>es.filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,id:e.id,text:(e.innerText||e.getAttribute("aria-label")||e.getAttribute("placeholder")||"").trim().slice(0,80)}))')
   for width in [1440,768,390]:
    q.set_viewport_size({'width':width,'height':900 if width>390 else 844});q.wait_for_timeout(250)
    file=f'sweep-{name}-{width}.png';q.screenshot(path=str(OUT/file),full_page=False)
    layout=q.evaluate('''() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,offscreen:[...document.querySelectorAll('button,input,select,h1,h2,header')].filter(e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.right>innerWidth+4||r.left < -4)&&r.top>=0&&r.top<innerHeight}).slice(0,20).map(e=>({tag:e.tagName,id:e.id,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,60),rect:{x:e.getBoundingClientRect().x,w:e.getBoundingClientRect().width}}))})''')
    rec['views'].append({'width':width,'screenshot':file,'layout':layout})
   q.set_viewport_size({'width':1440,'height':900})
   if axe:
    q.add_script_tag(content=axe);rec['axe']=q.evaluate('''async()=>{let r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})).slice(0,12)}))}''')
   else:rec['axeError']='CDN unavailable'
  except Exception as e:rec['error']=str(e)[:500]
  results.append(rec);(OUT/'sweep-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));q.close()
  print(json.dumps({'route':route,'status':rec.get('status'),'errors':len(rec['pageErrors']),'badResponses':len(rec['failedResponses']),'overflow':[v['width'] for v in rec['views'] if v['layout']['scrollWidth']>v['width']+2],'axe':[(v['id'],v['impact']) for v in rec.get('axe',[])],'error':rec.get('error')},ensure_ascii=False),flush=True)
 b.close()
