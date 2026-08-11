#!/usr/bin/env python3
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def body_html(file):
    text=(ROOT/file).read_text(encoding='utf-8')
    match=re.search(r'<body([^>]*)>([\s\S]*)</body>',text,re.I)
    return match.group(1),re.sub(r'<script[\s\S]*?</script>','',match.group(2),flags=re.I)

with sync_playwright() as p:
    launch_options={'headless':True,'args':ARGS}
    if Path('/usr/bin/chromium').exists():
      launch_options['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**launch_options)
    page=browser.new_page(viewport={'width':1280,'height':900});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    attrs,body=body_html('practice-mode.html')
    page.set_content(f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>')
    page.evaluate("""()=>{
      const data=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear(),key:i=>[...data.keys()][i]||null,get length(){return data.size}}});
      const questions=Array.from({length:20},(_,i)=>({bankId:'b1',questionId:'q'+(i+1),order:i+1}));
      const questionSnapshots=Array.from({length:20},(_,i)=>({bankId:'b1',bankName:'发布题库',bankSubject:'PMP',questionId:'q'+(i+1),question:{id:'q'+(i+1),title:'题目 '+(i+1),type:'single_choice',stemParts:[{text:'这是第 '+(i+1)+' 道题的题干'}],options:[{id:'A',text:'正确选项',correct:true},{id:'B',text:'错误选项'}],correctAnswer:'A'}}));
      localStorage.setItem('kg_exam_papers_published_v1',JSON.stringify([{id:'release-1',paperId:'paper-1',version:3,name:'PMP 发布练习卷',subject:'PMP',status:'published',publishedAt:Date.now(),questions,questionSnapshots}]));
      window.fetch=async url=>{
        if(String(url).includes('/api/v1/question-catalog/bootstrap'))return new Response(JSON.stringify({banks:[],questions:[],catalogRevision:'0'.repeat(64)}),{status:200,headers:{'content-type':'application/json'}});
        throw new Error('Unexpected request: '+url);
      };
      window.confirm=()=>true;
    }""")
    for file in ['styles/main.css','styles/account-menu.css','styles/user-center.css','styles/practice-mode.css','styles/learning-skin.css']:
      page.add_style_tag(content=(ROOT/file).read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT/'src/107-learning-ui-icons.js').read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT.parent/'frontend/scripts/new-legacy-assets/question-catalog-adapter.js').read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT/'src/100-practice-mode.js').read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(120)

    assert page.locator('[data-kg-icon] svg.kg-icon').count() >= 8
    assert page.locator('[data-kg-icon]:empty').count() == 0
    assert page.locator('#practicePaperSelect option').count()==1
    assert page.locator('#practicePaperLibrary .practice-paper-card').count()==1
    assert page.locator('#practiceLibraryFilters [data-paper-filter]').count()==3
    assert '可练习 20 题' in page.locator('#practicePaperMeta').inner_text()
    assert not page.locator('[name="practiceCount"][value="10"]').is_disabled()
    assert not page.locator('[name="practiceCount"][value="20"]').is_disabled()
    assert page.locator('[name="practiceCount"][value="60"]').is_disabled()
    assert page.locator('[name="practiceCount"][value="180"]').is_disabled()
    assert page.locator('[aria-label="题目导航"]').count()==0
    assert page.locator('.practice-mode-switch a').count()==2
    assert page.locator('.practice-mode-switch a.is-active').inner_text()=='做题'
    assert page.locator('.practice-mode-switch a[href="index.html"]').inner_text()=='自由'
    assert '只读取教师已经发布的固定版本' not in page.locator('#practiceLobby').inner_text()

    page.locator('[data-practice-start="challenge"]').click();page.wait_for_timeout(80)
    assert page.locator('#practiceGame').is_visible()
    assert page.locator('.practice-header').is_hidden()
    assert page.locator('#practiceTimer').is_hidden()
    assert page.locator('#practiceHealth .active').count()==3
    answers=['A','A','A','B','A']
    for idx,answer in enumerate(answers):
      page.locator(f'[data-option-id="{answer}"]').click()
      if idx==2:
        page.wait_for_timeout(80)
        assert not page.locator('#practiceStreakPop').is_hidden()
        assert '连胜 ×3' in page.locator('#practiceStreakPop').inner_text()
      page.wait_for_timeout(570)
    assert page.locator('#practiceCheckpoint').is_visible()
    assert page.locator('.practice-checkpoint-stats>div').count()==3
    assert page.locator('#practiceCheckpointStreak').inner_text()=='1'
    assert page.locator('#practiceCheckpointExperience').inner_text()=='42'
    assert page.locator('#practiceCheckpointContinue').inner_text()=='继续'
    page.locator('#practiceCheckpointContinue').click();page.wait_for_timeout(60)
    for _ in range(5):
      page.locator('[data-option-id="A"]').click();page.wait_for_timeout(570)
    assert page.locator('#practiceResult').is_visible()
    assert page.locator('#practiceResultAccuracy').inner_text()=='90%'
    assert page.locator('#practiceResultExperience').inner_text()=='106'
    assert page.locator('.practice-result-stats>div').count()==3

    page.locator('#practiceLobbyBtn').click();page.wait_for_timeout(80)
    assert page.locator('#practiceHistoryCount').inner_text()=='1'
    page.locator('#practiceHistoryOpenBtn').click();page.wait_for_timeout(80)
    assert page.locator('#practiceHistoryDrawer').is_visible()
    assert page.locator('.practice-history-row').count()==1
    page.locator('#practiceHistoryCloseBtn').click();page.wait_for_timeout(80)
    assert page.locator('#practiceHistoryDrawer').is_hidden()
    page.locator('[data-practice-start="scholar"]').click();page.wait_for_timeout(160)
    assert page.locator('#practiceTimer').is_visible()
    assert page.locator('#practiceTimeRow').is_visible()
    assert page.locator('.practice-time-icon').count()==1
    assert page.locator('#practiceScholarStreak').count()==0
    initial=page.evaluate('KGPracticeMode.snapshot().remainingSeconds')
    assert 78<=initial<=80
    page.evaluate("window.__practiceRealNow=Date.now;window.__practiceNowBase=Date.now();Date.now=()=>window.__practiceNowBase+60500")
    page.wait_for_timeout(420)
    faint=float(page.locator('#practiceDangerVignette').evaluate("el=>getComputedStyle(el).opacity"))
    assert 0 <= faint < .12
    assert 'is-danger' in (page.locator('#practiceTimeRail').get_attribute('class') or '')
    page.evaluate("Date.now=()=>window.__practiceNowBase+70000")
    page.wait_for_timeout(420)
    medium=float(page.locator('#practiceDangerVignette').evaluate("el=>getComputedStyle(el).opacity"))
    page.evaluate("Date.now=()=>window.__practiceNowBase+78000")
    page.wait_for_timeout(420)
    strong=float(page.locator('#practiceDangerVignette').evaluate("el=>getComputedStyle(el).opacity"))
    assert faint < medium < strong and strong > .65
    page.evaluate("Date.now=window.__practiceRealNow")
    page.wait_for_timeout(420)
    cleared=float(page.locator('#practiceDangerVignette').evaluate("el=>getComputedStyle(el).opacity"))
    assert cleared < .03
    page.locator('[data-option-id="B"]').click();page.wait_for_timeout(90)
    assert page.locator('[data-option-id="B"]').get_attribute('class').find('is-wrong')>=0
    page.wait_for_timeout(520)
    snap=page.evaluate('KGPracticeMode.snapshot()')
    assert snap['health']==2 and snap['index']==1 and snap['remainingSeconds']<=60
    before=snap['remainingSeconds']
    page.locator('[data-option-id="A"]').click();page.wait_for_timeout(90)
    assert page.locator('[data-option-id="A"]').get_attribute('class').find('is-correct')>=0
    page.wait_for_timeout(520)
    after=page.evaluate('KGPracticeMode.snapshot()')
    assert after['remainingSeconds']>before and after['streak']==1
    for expected in [2,3]:
      page.locator('[data-option-id="A"]').click();page.wait_for_timeout(570)
      assert page.evaluate('KGPracticeMode.snapshot().streak')==expected
    assert not page.locator('#practiceStreakPop').is_hidden()
    assert '连胜 ×3' in page.locator('#practiceStreakPop').inner_text()
    page.locator('[data-option-id="B"]').click();page.wait_for_timeout(570)
    assert page.locator('#practiceStreakPop').is_hidden()
    page.locator('#practiceExitBtn').click();page.wait_for_timeout(50)
    assert page.locator('#practiceExitConfirm').is_visible()
    t1=page.evaluate('KGPracticeMode.snapshot().remainingSeconds');page.wait_for_timeout(1150);t2=page.evaluate('KGPracticeMode.snapshot().remainingSeconds')
    assert t2<t1
    page.locator('#practiceExitConfirmBtn').click();page.wait_for_timeout(80)
    assert page.locator('#practiceLobby').is_visible()
    history=page.evaluate("JSON.parse(localStorage.getItem('kg_practice_history_v1__user__guest')||'[]')")
    assert any(item['status']=='completed' for item in history)
    assert any(item['status']=='abandoned' for item in history)
    assert not errors,errors
    browser.close()
print('v90-p40-practice-mode-browser-ok')
