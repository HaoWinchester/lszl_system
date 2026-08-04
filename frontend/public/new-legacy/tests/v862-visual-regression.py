from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'visual-regression'/'v8.6.2';OUT.mkdir(parents=True,exist_ok=True)
ARGS=['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader','--disable-crash-reporter','--disable-breakpad','--noerrdialogs']
def text(path):return (ROOT/path).read_text()
def body_html(path):
 s=text(path);m=re.search(r'<body[^>]*>([\s\S]*)</body>',s,re.I);return re.sub(r'<script[\s\S]*?</script>','',m.group(1),flags=re.I)
def storage(page):
 page.evaluate("""()=>{const m=new Map(),s=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}});Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>s.has(k)?s.get(k):null,setItem:(k,v)=>s.set(k,String(v)),removeItem:k=>s.delete(k),clear:()=>s.clear()}});const username='visual-student';localStorage.setItem('kg_local_current_user_v1',username);localStorage.setItem('kg_local_users_v1',JSON.stringify({[username]:{username,displayName:'视觉回归学员',role:'student',status:'active',subject:'PMP',salt:'x',hash:'x'}}));window.confirm=()=>true;}""")
def scripts(page,items):
 for item in items:page.add_script_tag(content=text(item))
manifest={'release':'v8.6.2','page':'learning-path.html','cases':[]}
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
 for width,height in [(1366,768),(1440,900),(1920,1080)]:
  for zoom in [100,125,150]:
   page=b.new_page(viewport={'width':width,'height':height});errors=[];page.on('pageerror',lambda e,errors=errors:errors.append(str(e)))
   page.set_content('<body class="guided-learning-page">'+body_html('learning-path.html')+'</body>');storage(page)
   page.add_style_tag(content=text('styles/main.css'));page.add_style_tag(content=text('styles/guided-learning-path.css'))
   scripts(page,['src/28-app-storage.js','src/29-auth-core.js','src/34-role-permissions.js','src/63-learning-event-repository.js','src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/94-practice-navigation.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/89-guided-learning-app.js'])
   page.evaluate('KGGuidedLearningApp.init()');page.evaluate('(z)=>document.documentElement.style.zoom=String(z)',zoom/100);page.wait_for_timeout(100)
   check=page.evaluate("""()=>{const overlaps=[];document.querySelectorAll('.gl-part').forEach(part=>{const cards=[...part.querySelectorAll('.gl-practice-entry')].map(el=>({id:el.dataset.glPracticeEntry,r:el.getBoundingClientRect()}));const nodes=[...part.querySelectorAll('.gl-path-node')].map(el=>({id:el.dataset.nodeWrap,r:el.getBoundingClientRect()}));cards.forEach(a=>nodes.forEach(b=>{if(a.r.left<b.r.right&&a.r.right>b.r.left&&a.r.top<b.r.bottom&&a.r.bottom>b.r.top)overlaps.push([a.id,b.id])}))});return {entries:document.querySelectorAll('.gl-practice-entry').length,overlaps,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}}""")
   assert check['entries']==6 and not check['overlaps'] and check['overflow']<=2 and not errors,(width,height,zoom,check,errors)
   manifest['cases'].append({'viewport':f'{width}x{height}','zoom':zoom,'practiceEntries':check['entries'],'overlaps':0,'pageOverflow':check['overflow']})
   page.close()
 b.close()
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('v862-visual-regression-ok',{'cases':len(manifest['cases'])})
