from pathlib import Path
import os
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def script(name): return (ROOT/name).read_text()

def install_storage(page,role='student'):
    page.evaluate("""role=>{const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}});window.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);window.cancelAnimationFrame=id=>clearTimeout(id);window.KGAuthCore={currentUsername:()=> 'browser-test',currentUser:()=>({username:'browser-test',role,status:'active'})};window.KGLearningEventRepository={append(){}};window.confirm=()=>true;}""",role)

def add_core(page):
    page.add_script_tag(content=script('src/86-activity-schema-v1.js'))
    page.add_script_tag(content=script('src/87-guided-learning-data.js'))
    page.add_script_tag(content=script('src/88-guided-learning-store.js'))

def path_html():
    return """
      <div id="status"></div>
      <button id="glStageSwitch" class="gl-stage-switch">
        <span class="gl-stage-switch-copy">
          <small id="glStageIndex"></small><strong id="glStageTitle"></strong><span id="glStageDescription"></span>
        </span>
      </button>
      <input id="glDefaultMode" type="checkbox"><div id="glPathParts"></div>
      <button id="glCurrentNodeBtn"><span></span></button><button id="glResetBtn"></button>
      <div id="glStagePicker"><button id="glStagePickerClose"></button><div id="glStageList"></div></div>
      <div id="glPlacementChoice" class="gl-placement-backdrop"><section class="gl-placement-dialog">
        <button id="glPlacementClose" class="gl-placement-close"></button><h3 id="glPlacementPartTitle"></h3>
        <p id="glPlacementPartDescription"></p><div id="glPlacementRequirements" class="gl-placement-requirements"></div>
        <p id="glPlacementHistory" class="gl-placement-history" hidden></p>
        <div class="gl-placement-actions"><button id="glPlacementNormalBtn" class="ui-button ui-button--secondary"></button><button id="glPlacementTestBtn" class="ui-button ui-button--primary"></button></div>
      </section></div>
    """

def test_path(browser):
    page=browser.new_page(viewport={'width':1200,'height':900})
    page.set_content(path_html())
    page.add_style_tag(content=script('styles/main.css'))
    page.add_style_tag(content=script('styles/guided-learning-path.css'))
    page.add_style_tag(content='*{transition:none!important}')
    page.evaluate("()=>{document.body.dataset.roleTheme='student';document.body.style.setProperty('--role-primary','#315bdd');document.body.style.setProperty('--role-accent','#f0b72d')}")
    install_storage(page);add_core(page)
    page.evaluate("()=>{const course=KGGuidedLearningData.getCourse();KGGuidedLearningStore.completeNode(course,course.nodes[0].id,{},'browser-test')}")
    page.add_script_tag(content=script('src/89-guided-learning-icon-registry.js'))
    page.add_script_tag(content=script('src/89-guided-learning-app.js'))
    page.evaluate('KGGuidedLearningApp.init()')
    page.wait_for_timeout(80)
    assert 'gl-stage-switch-arrow' not in script('learning-path.html')
    stage_button=page.locator('#glStageSwitch')
    stage_button.evaluate("el=>el.style.transition='none'")
    page.wait_for_timeout(30)
    stage_before=stage_button.evaluate("el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {transform:s.transform,shadow:s.boxShadow,filter:s.filter,top:r.top}}")
    stage_box=stage_button.bounding_box();page.mouse.move(stage_box['x']+stage_box['width']/2,stage_box['y']+stage_box['height']/2);page.wait_for_timeout(20)
    stage_during=stage_button.evaluate("el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {transform:s.transform,shadow:s.boxShadow,filter:s.filter,top:r.top}}")
    page.wait_for_timeout(240)
    stage_after=stage_button.evaluate("el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {transform:s.transform,shadow:s.boxShadow,filter:s.filter,top:r.top}}")
    assert stage_during['transform']=='none' and stage_after['transform']=='none'
    assert stage_during['filter']=='none' and stage_after['filter']=='none'
    during_depth=float(re.search(r'0px ([0-9.]+)px',stage_during['shadow']).group(1))
    after_depth=float(re.search(r'0px ([0-9.]+)px',stage_after['shadow']).group(1))
    assert during_depth>1 and after_depth>5.5
    assert abs(stage_during['top']-stage_before['top'])<0.1 and abs(stage_after['top']-stage_before['top'])<0.1
    assert page.locator('.gl-stage-option').count()==3
    assert page.locator('.gl-part').count()==3
    assert page.locator('.gl-part-divider').count()==3
    assert page.locator('.gl-path-curve').count()==0
    assert '--gl-path-y:0px' in page.locator('.gl-path-node').first.get_attribute('style')
    assert page.locator('.gl-part-divider-copy').first.evaluate("el=>getComputedStyle(el).writingMode").startswith('vertical')
    assert page.locator('.gl-part-divider-copy small').count()==0
    assert page.locator('[data-gl-node]').count()==36
    assert page.locator('.gl-path-node.is-completed').count()==1
    assert page.locator('.gl-path-node.is-available').count()==1
    assert page.locator('.gl-path-node.is-current').count()==1
    assert page.locator('.gl-path-node.is-locked').count()==34
    assert page.locator('.gl-node-base').count()==36
    assert page.locator('.gl-node-face').count()==36
    assert page.locator('.gl-node-svg').count()==36
    assert page.locator('.gl-node-button b').count()==0
    assert page.locator('[data-gl-node]').first.get_attribute('title')=='环境线索'
    assert page.locator('.gl-node-copy small').count()==0
    assert page.locator('.gl-placement-badge').count()==1
    page.locator('[data-gl-placement-part="environment"]').dispatch_event('click')
    assert page.locator('#glPlacementChoice.is-open').count()==1
    assert page.locator('#glPlacementPartTitle').text_content()=='识别方法环境'
    assert '12 项' in page.locator('#glPlacementRequirements').text_content()
    placement_button=page.locator('#glPlacementTestBtn')
    placement_normal=placement_button.evaluate("el=>({shadow:getComputedStyle(el).boxShadow,bg:getComputedStyle(el).backgroundImage,classes:el.className})")
    assert 'primary' not in placement_normal['classes'].split()
    assert re.search(r'0px 4px 0px',placement_normal['shadow'])
    assert placement_normal['bg']=='none'
    placement_before=placement_button.bounding_box();page.mouse.move(placement_before['x']+placement_before['width']/2,placement_before['y']+placement_before['height']/2);page.wait_for_timeout(180)
    placement_hover=placement_button.evaluate("el=>({shadow:getComputedStyle(el).boxShadow,transform:getComputedStyle(el).transform})")
    placement_after=placement_button.bounding_box()
    assert placement_hover['transform'] in ('none','matrix(1, 0, 0, 1, 0, 0)')
    assert re.search(r'0px 4px 0px',placement_hover['shadow'])
    assert abs(placement_after['y']-placement_before['y'])<0.1
    page.mouse.down();page.wait_for_timeout(20)
    assert placement_button.evaluate("el=>getComputedStyle(el).boxShadow")=='none'
    page.mouse.up();page.wait_for_timeout(20)
    page.locator('#glPlacementClose').dispatch_event('click')
    assert page.locator('#glPlacementChoice.is-open').count()==0
    assert page.evaluate("""()=>KGGuidedLearningIconRegistry.render('not-registered').includes('data-icon-key="fallback"')""")
    colors=page.evaluate("""()=>({
      completed:getComputedStyle(document.querySelector('.is-completed .gl-node-face')).backgroundColor,
      current:getComputedStyle(document.querySelector('.is-available .gl-node-face')).backgroundColor,
      buttonAnimation:getComputedStyle(document.querySelector('.is-available .gl-node-button')).animationName,
      ringAnimation:getComputedStyle(document.querySelector('.is-available .gl-node-button'),'::before').animationName,
      overflow:getComputedStyle(document.querySelector('.is-available .gl-node-button')).overflow
    })""")
    assert colors['completed']!=colors['current']
    assert colors['buttonAnimation']=='none'
    assert colors['ringAnimation']=='gl-current-node-ring-pulse'
    assert colors['overflow']=='visible'
    current_button=page.locator('.is-available .gl-node-button')
    current_hover_box=current_button.bounding_box();page.mouse.move(current_hover_box['x']+current_hover_box['width']/2,current_hover_box['y']+current_hover_box['height']/2)
    assert page.locator('.is-available .gl-node-face').evaluate("el=>getComputedStyle(el).transform")=='none'
    box=current_button.bounding_box()
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
    page.mouse.down();page.wait_for_timeout(40)
    assert page.locator('.is-available .gl-node-face').evaluate("el=>getComputedStyle(el).transform")!='none'
    page.mouse.move(1,1);page.mouse.up()
    dimensions=page.evaluate("()=>{const el=document.querySelector('.gl-stage-path-scroll');return {client:el.clientWidth,scroll:el.scrollWidth,left:el.scrollLeft}}")
    assert dimensions['scroll']>dimensions['client']
    first_theme=page.locator('#glStageSwitch').evaluate("el=>getComputedStyle(el).getPropertyValue('--gl-part-main').trim()")
    page.evaluate("""()=>KGGuidedLearningApp.setActivePart('roles-process',{force:true})""")
    page.wait_for_timeout(30)
    second_theme=page.locator('#glStageSwitch').evaluate("el=>getComputedStyle(el).getPropertyValue('--gl-part-main').trim()")
    assert first_theme!=second_theme
    assert page.locator('#glStageTitle').text_content()=='理解角色与顺序'
    page.locator('#glStageSwitch').dispatch_event('click');assert page.locator('#glStagePicker.is-open').count()==1
    page.locator('[data-gl-stage="reasoning"]').dispatch_event('click')
    assert page.locator('#glStageTitle').text_content()=='拆解题干与约束'
    page.close()



def test_desktop_entry_matrix(browser):
    cases=[
        (1366,1),
        (1440,0.8),(1440,1),(1440,1.25),
        (1920,1)
    ]
    page=browser.new_page(viewport={'width':1366,'height':900})
    page.set_default_timeout(8000)
    for width,zoom in cases:
        page.set_viewport_size({'width':width,'height':900})
        page.goto('about:blank')
        page.set_content(path_html())
        page.add_style_tag(content=script('styles/main.css'))
        page.add_style_tag(content=script('styles/guided-learning-path.css'))
        page.add_style_tag(content='*{transition:none!important}')
        install_storage(page);add_core(page)
        page.evaluate("()=>{const course=KGGuidedLearningData.getCourse();KGGuidedLearningStore.completeNode(course,course.nodes[0].id,{},'browser-test')}")
        page.add_script_tag(content=script('src/89-guided-learning-icon-registry.js'))
        page.add_script_tag(content=script('src/89-guided-learning-app.js'))
        page.evaluate('KGGuidedLearningApp.init()')
        page.evaluate('zoom=>{document.documentElement.style.zoom=String(zoom)}',zoom)
        page.wait_for_timeout(50)
        stage=page.locator('#glStageSwitch')
        stage.evaluate("el=>el.style.transition='none'")
        before=stage.bounding_box()
        page.mouse.move(before['x']+before['width']/2,before['y']+before['height']/2)
        page.wait_for_timeout(20)
        style=stage.evaluate("el=>{const s=getComputedStyle(el);return {transform:s.transform,filter:s.filter,shadow:s.boxShadow}}")
        after=stage.bounding_box()
        depth=float(re.search(r'0px ([0-9.]+)px',style['shadow']).group(1))
        assert style['transform']=='none' and style['filter']=='none' and depth>1
        assert abs(after['y']-before['y'])<0.1
        face=page.locator('.gl-node-face').first.bounding_box()
        assert face['width']>40 and face['height']>40
        ratio=face['width']/face['height']
        assert 1.12<ratio<1.35
        current=page.locator('.gl-path-node.is-available')
        current_box=current.bounding_box();scroll_box=page.locator('.gl-stage-path-scroll').bounding_box()
        assert current_box['y']>=scroll_box['y']-2
        assert current_box['y']+current_box['height']<=scroll_box['y']+scroll_box['height']+2


def test_admin_access(browser):
    page=browser.new_page(viewport={'width':1200,'height':900})
    page.set_content(path_html())
    page.add_style_tag(content=script('styles/main.css'))
    page.add_style_tag(content=script('styles/guided-learning-path.css'))
    page.add_style_tag(content='*{transition:none!important}')
    install_storage(page,'admin');add_core(page)
    page.add_script_tag(content=script('src/89-guided-learning-icon-registry.js'))
    page.add_script_tag(content=script('src/89-guided-learning-app.js'))
    page.evaluate('KGGuidedLearningApp.init()')
    page.wait_for_timeout(80)
    assert page.locator('.gl-path-node.is-admin-open').count()==35
    assert page.locator('[data-gl-node][href]').count()==36
    assert page.locator('.gl-path-node.is-current').count()==1
    assert page.locator('.gl-placement-badge').count()==0
    page.close()

    node_page=new_node_page(browser,'integration-challenge',0,'admin')
    assert node_page.locator('.gln-fatal').count()==0
    assert node_page.locator('#glnTitle').text_content()=='部分综合挑战'
    assert node_page.locator('[data-choice]').count()==4
    assert '已完成 0 / 8' in node_page.locator('.gln-challenge-context').text_content()
    node_page.close()


def test_path_position_memory(browser):
    page=browser.new_page(viewport={'width':1200,'height':760})
    page.set_content(path_html())
    page.add_style_tag(content=script('styles/guided-learning-path.css'))
    page.add_style_tag(content='*{transition:none!important}')
    install_storage(page);add_core(page)
    page.evaluate("index=>{const course=KGGuidedLearningData.getCourse();for(let i=0;i<index;i+=1)KGGuidedLearningStore.completeNode(course,course.nodes[i].id,{},'browser-test')}",15)
    page.add_script_tag(content=script('src/89-guided-learning-icon-registry.js'))
    page.add_script_tag(content=script('src/89-guided-learning-app.js'));page.evaluate('KGGuidedLearningApp.init()');page.wait_for_timeout(80)
    first_position=page.evaluate("document.querySelector('.gl-stage-path-scroll').scrollLeft")
    assert first_position>900
    page.evaluate("()=>{const el=document.querySelector('.gl-stage-path-scroll');el.style.scrollBehavior='auto';el.scrollLeft=260;el.dispatchEvent(new Event('scroll'))}")
    page.wait_for_timeout(140);page.evaluate('KGGuidedLearningApp.renderAll()');page.wait_for_timeout(80)
    restored=page.evaluate("document.querySelector('.gl-stage-path-scroll').scrollLeft")
    assert abs(restored-260)<8
    page.close()


def placement_html():
    text=script('guided-learning-placement-test.html')
    text=re.sub(r'<link[^>]+>', '', text)
    text=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', text)
    return text


def new_placement_page(browser,part_id,unlock_index=0,role='student'):
    page=browser.new_page(viewport={'width':1100,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(placement_html())
    page.add_style_tag(content=script('styles/main.css'))
    page.add_style_tag(content=script('styles/guided-learning-placement-test.css'))
    page.add_style_tag(content='*{transition:none!important}')
    install_storage(page,role);add_core(page)
    if unlock_index:
        page.evaluate("index=>{const course=KGGuidedLearningData.getCourse();for(let i=0;i<index;i+=1)KGGuidedLearningStore.completeNode(course,course.nodes[i].id,{},'browser-test')}",unlock_index)
    page.add_script_tag(content=script('src/89-guided-learning-placement-test.js'))
    page.evaluate("partId=>KGGuidedLearningPlacementTest.init(partId)",part_id)
    page.wait_for_timeout(60)
    assert not errors,errors
    return page


def answer_placement_current(page,part_id,correct=True):
    activity_type=page.evaluate("()=>{const id=document.querySelector('#gptQuestion').dataset.activityId;return KGGuidedLearningData.placementTestForPart('"+part_id+"').activities.find(a=>a.id===id).type}")
    activity_id=page.locator('#gptQuestion').get_attribute('data-activity-id')
    if activity_type=='choice':
        option=page.evaluate("""({partId,activityId,correct})=>{const a=KGGuidedLearningData.placementTestForPart(partId).activities.find(item=>item.id===activityId);return a.options.find(option=>Boolean(option.correct)===correct).id}""",{'partId':part_id,'activityId':activity_id,'correct':correct})
        page.locator(f'[data-gpt-choice="{option}"]').dispatch_event('click')
    elif activity_type=='keyword':
        mapping=page.evaluate("""({partId,activityId})=>{const a=KGGuidedLearningData.placementTestForPart(partId).activities.find(item=>item.id===activityId);const targets=a.segments.map((s,i)=>s.target?i:null).filter(i=>i!==null);const others=a.segments.map((s,i)=>!s.target?i:null).filter(i=>i!==null);return {targets,others,required:a.requiredSelectionCount}}""",{'partId':part_id,'activityId':activity_id})
        indexes=mapping['targets'] if correct else (mapping['others'][:mapping['required']])
        for index in indexes: page.locator(f'[data-gpt-keyword="{index}"]').dispatch_event('click')
    elif activity_type=='matching':
        pairs=page.evaluate("""({partId,activityId})=>KGGuidedLearningData.placementTestForPart(partId).activities.find(item=>item.id===activityId).pairs.map(pair=>pair.id)""",{'partId':part_id,'activityId':activity_id})
        for index,left in enumerate(pairs):
            right=left if correct else pairs[(index+1)%len(pairs)]
            page.locator(f'[data-gpt-match-left="{left}"]').dispatch_event('click')
            page.locator(f'[data-gpt-match-right="{right}"]').dispatch_event('click')
    else:
        raise AssertionError('unsupported placement type '+activity_type)
    page.locator('#gptPrimaryAction').dispatch_event('click')


def run_placement_answers(page,part_id,correct_count):
    page.locator('#gptStartBtn').dispatch_event('click')
    total=page.evaluate("partId=>KGGuidedLearningData.placementTestForPart(partId).activities.length",part_id)
    for index in range(total):
        answer_placement_current(page,part_id,index<correct_count)
        page.locator('#gptPrimaryAction').dispatch_event('click')


def test_placement_test(browser):
    part_id='environment'
    page=new_placement_page(browser,part_id)
    assert page.locator('#gptTaskCount').text_content()=='12 项'
    assert '至少 10 项正确' in page.locator('#gptPassRule').text_content()

    start=page.locator('#gptStartBtn')
    start.evaluate("el=>el.style.transition='none'")
    before=start.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {top:r.top,transform:s.transform,shadow:s.boxShadow,classes:el.className}}")
    assert 'primary' not in before['classes'].split()
    assert re.search(r'0px 4px 0px',before['shadow'])
    box=start.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.wait_for_timeout(20)
    hovered=start.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {top:r.top,transform:s.transform,shadow:s.boxShadow}}")
    assert abs(hovered['top']-before['top'])<0.1
    assert '4px' in hovered['shadow']
    start.dispatch_event('click')
    disabled_action=page.locator('#gptPrimaryAction')
    disabled_style=disabled_action.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {disabled:el.disabled,shadow:s.boxShadow,transform:s.transform,y:r.y}}")
    assert disabled_style['disabled'] is True
    assert re.search(r'0px 4px 0px',disabled_style['shadow'])
    disabled_box=disabled_action.bounding_box();page.mouse.move(disabled_box['x']+disabled_box['width']/2,disabled_box['y']+disabled_box['height']/2);page.mouse.down();page.wait_for_timeout(15)
    disabled_pressed=disabled_action.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {shadow:s.boxShadow,transform:s.transform,y:r.y}}")
    assert re.search(r'0px 4px 0px',disabled_pressed['shadow'])
    assert abs(disabled_pressed['y']-disabled_style['y'])<0.1
    page.mouse.up();page.wait_for_timeout(15)
    first_choice=page.locator('[data-gpt-choice]').first
    choice_box=first_choice.bounding_box();page.mouse.move(choice_box['x']+choice_box['width']/2,choice_box['y']+choice_box['height']/2);page.wait_for_timeout(20)
    assert first_choice.evaluate("el=>getComputedStyle(el).transform")=='none'
    first_choice.dispatch_event('click')
    assert first_choice.evaluate("el=>getComputedStyle(el).boxShadow")!='none'
    action=page.locator('#gptPrimaryAction')
    before_action=action.evaluate("el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,label:el.textContent}}")
    action_box=action.bounding_box();page.mouse.move(action_box['x']+action_box['width']/2,action_box['y']+action_box['height']/2);page.mouse.down();page.wait_for_timeout(15)
    pressed=action.evaluate("el=>({transform:getComputedStyle(el).transform,shadow:getComputedStyle(el).boxShadow})")
    assert pressed['transform']!='none' and ('4' in pressed['transform'] or 'matrix' in pressed['transform'])
    assert pressed['shadow']=='none'
    page.mouse.up();page.wait_for_timeout(15)
    after_action=action.evaluate("el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,label:el.textContent}}")
    assert before_action['label']=='提交答案' and after_action['label']=='下一项'
    assert all(abs(after_action[key]-before_action[key])<0.1 for key in ['x','y','width','height'])
    page.locator('#gptExitBtn').dispatch_event('click')

    page.close()
    page=new_placement_page(browser,part_id)
    run_placement_answers(page,part_id,9)
    assert page.locator('#gptResult:not([hidden])').count()==1
    assert page.locator('#gptResultLabel').text_content()=='跳级测试未通过'
    assert page.locator('#gptCorrectResult').text_content()=='9 / 12'
    failed=page.evaluate("partId=>KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').placementTests[partId]",part_id)
    assert failed['attemptCount']==1 and failed['passed'] is False and failed['bestCorrect']==9
    states=page.evaluate("""()=>{const c=KGGuidedLearningData.getCourse(),p=KGGuidedLearningStore.read(c,'browser-test');return [p.nodes[c.nodes[0].id].status,p.nodes[c.nodes[1].id].status]}""")
    assert states==['available','locked']

    page.locator('[data-gpt-retry]').dispatch_event('click')
    # second attempt: first ten correct and last two incorrect
    total=12
    for index in range(total):
        answer_placement_current(page,part_id,index<10)
        page.locator('#gptPrimaryAction').dispatch_event('click')
    assert page.locator('#gptResultLabel').text_content()=='跳级测试通过'
    assert page.locator('#gptCorrectResult').text_content()=='10 / 12'
    progress=page.evaluate("""partId=>{const c=KGGuidedLearningData.getCourse(),p=KGGuidedLearningStore.read(c,'browser-test');const partNodes=c.nodes.filter(n=>n.partId===partId);const next=c.nodes.find(n=>n.partId===c.parts[1].id&&n.order===1);return {nodes:partNodes.map(n=>p.nodes[n.id]),next:p.nodes[next.id].status,record:p.placementTests[partId]}}""",part_id)
    assert all(node['status']=='completed' and 'completionMethod' not in node for node in progress['nodes'])
    assert progress['next']=='available'
    assert progress['record']['attemptCount']==2 and progress['record']['passed'] is True
    page.close()


def node_html():
    text=script('guided-learning-node.html')
    text=re.sub(r'<link[^>]+>', '', text)
    text=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', text)
    return text


def new_node_page(browser,node_id,unlock_index=0,role='student'):
    page=browser.new_page(viewport={'width':1200,'height':900})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content(node_html())
    page.add_style_tag(content=script('styles/main.css'))
    page.add_style_tag(content=script('styles/guided-learning-node.css'))
    page.add_style_tag(content='*{transition:none!important}')
    install_storage(page,role);add_core(page)
    if unlock_index:
        page.evaluate("index=>{const course=KGGuidedLearningData.getCourse();for(let i=0;i<index;i+=1)KGGuidedLearningStore.completeNode(course,course.nodes[i].id,{},'browser-test')}",unlock_index)
    page.add_script_tag(content=script('src/89-guided-learning-activity-registry.js'))
    page.add_script_tag(content=script('src/89-guided-learning-deep-recall.js'))
    page.add_script_tag(content=script('src/89-guided-learning-multi-induction.js'))
    page.add_script_tag(content=script('src/89-guided-learning-knowledge-graph.js'))
    page.add_script_tag(content=script('src/90-guided-learning-node-app.js'))
    page.evaluate("nodeId=>KGGuidedLearningNodeApp.init(nodeId)",node_id)
    page.wait_for_timeout(60)
    assert not errors, errors
    return page


def answer_keyword_correct(page,node_id):
    targets=page.evaluate("""nodeId=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);return a.segments.map((s,i)=>s.target?i:null).filter(i=>i!==null)}""",node_id)
    for index in targets: page.locator(f'[data-keyword="{index}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')


def answer_choice_correct(page,node_id):
    correct=page.evaluate("""nodeId=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);return a.options.find(o=>o.correct).id}""",node_id)
    page.locator(f'[data-choice="{correct}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')


def answer_matching_correct(page,node_id):
    pairs=page.evaluate("""nodeId=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);return a.pairs.map(pair=>pair.id)}""",node_id)
    for pair_id in pairs:
        page.locator(f'[data-match-left="{pair_id}"]').dispatch_event('click')
        page.locator(f'[data-match-right="{pair_id}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')


def complete_knowledge_graph_correct(page,node_id):
    while page.locator('.gln-kg-board').count():
        instruction=page.locator('.gln-question-head h2').text_content()
        if page.locator('[data-kg-option]').count():
            correct=page.evaluate("""({nodeId,instruction})=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);const task=[...(a.missingNodeTasks||[]),...(a.relationTasks||[])].find(item=>item.instruction===instruction);return task.correctOptionId}""",{'nodeId':node_id,'instruction':instruction})
            page.locator(f'[data-kg-option="{correct}"]').dispatch_event('click')
        else:
            correct=page.evaluate("""({nodeId,instruction})=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);const task=(a.errorConnectionTasks||[]).find(item=>item.instruction===instruction);return task.incorrectEdgeId}""",{'nodeId':node_id,'instruction':instruction})
            page.locator(f'[data-kg-error-edge="{correct}"]').dispatch_event('click')
        page.locator('[data-footer-action="check"]').dispatch_event('click')
        if page.locator('[data-footer-action="kg-next"]').count():
            page.locator('[data-footer-action="kg-next"]').dispatch_event('click')
        elif page.locator('[data-footer-action="continue"]').count():
            page.locator('[data-footer-action="continue"]').dispatch_event('click')
            return
        else:
            raise AssertionError('知识图谱正确答案后没有后续按钮')


def answer_open_correct(page,node_id):
    answer=page.evaluate("""nodeId=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(x=>x.id===id);return a.requiredConcepts.map(c=>c.acceptedExpressions[0]).join('，')+'，本次处理还需要进行充分沟通、持续跟进并保留完整记录。'}""",node_id)
    page.locator('#glnOpenTextInput').fill(answer);page.locator('[data-footer-action="check"]').dispatch_event('click')


def test_keyword(browser):
    page=new_node_page(browser,'awareness-keywords',0)
    assert page.locator('#glnProgressText').count()==0
    assert page.locator('[data-keyword]').count()==5
    style=page.locator('[data-keyword]').first.evaluate("el=>({border:getComputedStyle(el).borderWidth,padding:getComputedStyle(el).padding,margin:getComputedStyle(el).margin})")
    assert style['border']=='0px' and style['padding']=='0px' and style['margin']=='0px'
    page.locator('[data-keyword="0"]').dispatch_event('click');page.locator('[data-keyword="1"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="error"]').count()==1
    stored=page.evaluate("localStorage.getItem(KGGuidedLearningStore.PREFIX+encodeURIComponent('browser-test')+'__'+encodeURIComponent(KGGuidedLearningData.getCourse().id))")
    assert stored is None
    page.close()


def test_choice_completion_metrics(browser):
    node_id='awareness-terms'
    page=new_node_page(browser,node_id,1)
    page.evaluate("()=>{document.body.dataset.roleTheme='student';document.body.style.setProperty('--role-primary','#315bdd');document.body.style.setProperty('--role-accent','#f0b72d')}")
    # 第一题先答错一次，同时验证主按钮固定槽位与按压反馈。
    main_action=page.locator('[data-footer-action="check"]')
    before_action=main_action.evaluate("el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}")
    initial_disabled=main_action.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {disabled:el.disabled,shadow:s.boxShadow,transform:s.transform,y:r.y}}")
    assert initial_disabled['disabled'] is True
    assert re.search(r'0px 4px 0px',initial_disabled['shadow'])
    disabled_box=main_action.bounding_box();page.mouse.move(disabled_box['x']+disabled_box['width']/2,disabled_box['y']+disabled_box['height']/2);page.mouse.down();page.wait_for_timeout(15)
    disabled_pressed=main_action.evaluate("el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {shadow:s.boxShadow,transform:s.transform,y:r.y}}")
    assert re.search(r'0px 4px 0px',disabled_pressed['shadow'])
    assert abs(disabled_pressed['y']-initial_disabled['y'])<0.1
    page.mouse.up();page.wait_for_timeout(15)
    page.locator('[data-choice="B"]').dispatch_event('click')
    enabled_style=main_action.evaluate("el=>({shadow:getComputedStyle(el).boxShadow,classes:el.className,disabled:el.disabled})")
    assert enabled_style['disabled'] is False
    assert 'primary' not in enabled_style['classes'].split()
    assert re.search(r'0px 4px 0px',enabled_style['shadow'])
    action_box=main_action.bounding_box();page.mouse.move(action_box['x']+action_box['width']/2,action_box['y']+action_box['height']/2);page.mouse.down();page.wait_for_timeout(15)
    assert main_action.evaluate("el=>getComputedStyle(el).boxShadow")=='none'
    page.mouse.up();page.wait_for_timeout(15)
    continue_action=page.locator('[data-footer-action="continue"]')
    after_action=continue_action.evaluate("el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}")
    assert all(abs(after_action[key]-before_action[key])<0.1 for key in ['x','y','width','height'])
    assert page.locator('.gln-choice-list .is-correct').count()==0
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    # 完成剩余队列，错题最终回到末尾
    while page.locator('.gln-complete').count()==0:
        answer_choice_correct(page,node_id)
        page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-result-grid').count()==1
    labels=page.locator('.gln-result-grid span').all_text_contents()
    assert labels==['正确率','用时','最长连对']
    assert page.locator('.gln-complete p').count()==0
    accuracy=page.locator('.gln-result-grid strong').nth(0).text_content()
    assert accuracy=='86%'
    stored=page.evaluate("KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes['awareness-terms'].metrics")
    assert stored['accuracy']==86 and stored['totalAttempts']==7 and stored['correctAttempts']==6
    page.close()


def test_matching(browser):
    page=new_node_page(browser,'understanding-roles',2)
    assignments=[('po','team'),('team','stakeholder'),('stakeholder','po')]
    for left,right in assignments:
        page.locator(f'[data-match-left="{left}"]').dispatch_event('click');page.locator(f'[data-match-right="{right}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert '3 组配对' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-match-column .is-assigned').count()==0
    page.close()


def test_mixed_process_node(browser):
    node_id='understanding-process'
    page=new_node_page(browser,node_id,3)
    activity_types=page.evaluate("""()=>KGGuidedLearningData.activitiesForNode('understanding-process').map(activity=>activity.type)""")
    assert activity_types==['choice','choice','choice','choice','open_text']
    for _ in range(4):
        assert page.locator('[data-choice]').count()==4
        answer_choice_correct(page,node_id)
        page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('#glnOpenTextInput').count()==1
    assert page.locator('#glnOpenTextInput').get_attribute('minlength')=='1'
    assert '填写后即可提交' in page.locator('.gln-open-text-meta').text_content()
    page.locator('#glnOpenTextInput').fill('先判断环境，再评估价值和容量。')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert '参考答案：' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-complete').count()==1
    metrics=page.evaluate("KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes['understanding-process'].metrics")
    assert metrics['totalAttempts']==5 and metrics['correctAttempts']==5
    page.close()


def test_structure_retry_hint(browser):
    node_id='analysis-structure'
    page=new_node_page(browser,node_id,4)
    assert page.locator('[data-keyword-hint]').count()==0
    for index in [0,2,4]:
        page.locator(f'[data-keyword="{index}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="error"]').count()==1
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    for _ in range(6):
        answer_keyword_correct(page,node_id)
        page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('[data-keyword-hint]').count()==1
    page.locator('[data-keyword-hint]').dispatch_event('click')
    assert page.locator('.gln-keyword-hint-panel p').count()==1
    assert '提示' in page.locator('.gln-keyword-hint-panel p').text_content()
    page.close()



def test_part_challenge(browser):
    node_id='foundation-practice-integration-challenge'
    page=new_node_page(browser,node_id,35)
    types=page.evaluate("""nodeId=>KGGuidedLearningData.activitiesForNode(nodeId).map(activity=>activity.type)""",node_id)
    assert types==['choice','choice','choice','choice','keyword','matching','open_text','knowledge_graph']
    assert page.locator('.gln-challenge-context').count()==1
    assert '已完成 0 / 8' in page.locator('.gln-challenge-context').text_content()

    # 第一项选择题先答错，验证错题进入队尾并影响首答正确率。
    wrong=page.evaluate("""nodeId=>{const id=document.querySelector('#glnActivity').dataset.activityId;const a=KGGuidedLearningData.activitiesForNode(nodeId).find(item=>item.id===id);return a.options.find(option=>!option.correct).id}""",node_id)
    page.locator(f'[data-choice="{wrong}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    page.locator('[data-footer-action="continue"]').dispatch_event('click')

    # 完成剩余三道选择题。
    for _ in range(3):
        answer_choice_correct(page,node_id)
        page.locator('[data-footer-action="continue"]').dispatch_event('click')

    # 关键词识别、连线配对和开放表达。
    answer_keyword_correct(page,node_id)
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    answer_matching_correct(page,node_id)
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    page.locator('#glnOpenTextInput').fill('先判断环境，再评估价值、职责和约束。')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    page.locator('[data-footer-action="continue"]').dispatch_event('click')

    # 正确完成知识图谱复合任务。
    complete_knowledge_graph_correct(page,node_id)

    # 队尾重新出现首道错题，最终答对后完成挑战。
    assert page.locator('[data-choice]').count()==4
    assert '已完成 7 / 8' in page.locator('.gln-challenge-context').text_content()
    answer_choice_correct(page,node_id)
    page.locator('[data-footer-action="continue"]').dispatch_event('click')

    assert page.locator('.gln-complete.is-challenge').count()==1
    assert page.locator('.gln-complete>span').text_content()=='本部分挑战完成'
    labels=page.locator('.gln-challenge-results span').all_text_contents()
    assert labels==['首答正确率','活跃用时','最长连对','最薄弱题型']
    assert page.locator('.gln-challenge-results strong').nth(0).text_content()=='88%'
    assert page.locator('.gln-challenge-results strong').nth(3).text_content()=='单项选择'
    assert page.locator('.gln-type-performance article').count()==5

    metrics=page.evaluate("""nodeId=>KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes[nodeId].metrics""",node_id)
    assert metrics['firstAttemptTotal']==8 and metrics['firstAttemptCorrect']==7 and metrics['firstAttemptAccuracy']==88
    assert metrics['challengeCompleted'] is True and metrics['challengePartId']=='foundation-practice'
    choice=next(item for item in metrics['typePerformance'] if item['type']=='choice')
    assert choice['total']==4 and choice['firstAttemptCorrect']==3 and choice['firstAttemptAccuracy']==75
    part_done=page.evaluate("""()=>KGGuidedLearningStore.partSummary(KGGuidedLearningData.getCourse(),'foundation-practice',KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test')).done""")
    assert part_done is True
    page.close()



def test_memory_match(browser):
    node_id='application-recall'
    page=new_node_page(browser,node_id,7)
    assert page.locator('[data-memory-card]').count()==8
    assert page.locator('[data-footer-action]').count()==0
    # 一次错误翻牌
    page.locator('[data-memory-card="po-backlog:left"]').dispatch_event('click');page.locator('[data-memory-card="team-capacity:right"]').dispatch_event('click')
    page.wait_for_timeout(850)
    assert page.locator('.gln-memory-card.is-flipped').count()==0
    pairs=page.evaluate("""()=>KGGuidedLearningData.activitiesForNode('application-recall')[0].pairs.map(p=>p.id)""")
    for pair in pairs:
        page.locator(f'[data-memory-card="{pair}:left"]').dispatch_event('click');page.locator(f'[data-memory-card="{pair}:right"]').dispatch_event('click');page.wait_for_timeout(390)
    page.wait_for_timeout(350)
    assert page.locator('[data-footer-action="continue"]').count()==1
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-complete').count()==1
    assert page.locator('.gln-result-grid strong').nth(0).text_content()=='80%'
    assert page.locator('.gln-result-grid strong').nth(2).text_content()=='4 次'
    page.close()


def test_deep_recall(browser):
    node_id='application-deep-recall'
    page=new_node_page(browser,node_id,6)
    assert page.locator('.gln-deep-steps').count()==1
    assert page.locator('[data-deep-clue]').count()==7

    # 线索识别连续错两次后开放第一条提示，提示不标出正确答案。
    for attempt in range(2):
        for index in [0,1,2]: page.locator(f'[data-deep-clue="{index}"]').dispatch_event('click')
        page.locator('[data-footer-action="check"]').dispatch_event('click')
        assert page.locator('#glnFeedback[data-kind="error"]').count()==1
        assert page.locator('.is-correct').count()==0
        if attempt==0:
            assert page.locator('[data-footer-action="deep-hint"]').count()==0
        else:
            assert page.locator('[data-footer-action="deep-hint"]').count()==1
            page.locator('[data-footer-action="deep-hint"]').dispatch_event('click')
            assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
        page.locator('[data-footer-action="deep-retry"]').dispatch_event('click')
    assert page.locator('.gln-deep-hints p').count()==1
    targets=page.evaluate("""()=>KGGuidedLearningData.activitiesForNode('application-deep-recall')[0].clueTask.segments.map((s,i)=>s.target?i:null).filter(i=>i!==null)""")
    for index in targets: page.locator(f'[data-deep-clue="{index}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click');page.locator('[data-footer-action="deep-next"]').dispatch_event('click')

    # 第一道人物/环境判断答错一次后进入队尾。
    first_wrong=page.evaluate("""()=>{const a=KGGuidedLearningData.activitiesForNode('application-deep-recall')[0];return a.conceptQuestions[0].options.find(o=>!o.correct).id}""")
    page.locator(f'[data-deep-choice="{first_wrong}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="deep-hint"]').count()==0
    page.locator('[data-footer-action="deep-retry"]').dispatch_event('click')

    # 完成第二、第三题，使第一题再次出现。
    for _ in range(2):
        correct=page.evaluate("""()=>{const stem=document.querySelector('.gln-question-head h2').textContent;const a=KGGuidedLearningData.activitiesForNode('application-deep-recall')[0];return a.conceptQuestions.find(q=>q.stem===stem).options.find(o=>o.correct).id}""")
        page.locator(f'[data-deep-choice="{correct}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click');page.locator('[data-footer-action="deep-next"]').dispatch_event('click')

    # 同一知识判断第二次答错后开放该题提示。
    page.locator(f'[data-deep-choice="{first_wrong}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="deep-hint"]').count()==1
    page.locator('[data-footer-action="deep-hint"]').dispatch_event('click')
    assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="deep-retry"]').dispatch_event('click')
    assert page.locator('.gln-deep-hints p').count()==1
    first_correct=page.evaluate("""()=>{const stem=document.querySelector('.gln-question-head h2').textContent;const a=KGGuidedLearningData.activitiesForNode('application-deep-recall')[0];return a.conceptQuestions.find(q=>q.stem===stem).options.find(o=>o.correct).id}""")
    page.locator(f'[data-deep-choice="{first_correct}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click');page.locator('[data-footer-action="deep-next"]').dispatch_event('click')

    assert page.locator('[data-deep-order]').count()==5
    # 路径排序连续错两次后开放提示。
    for attempt in range(2):
        page.locator('[data-footer-action="check"]').dispatch_event('click')
        assert '个步骤的位置' in page.locator('#glnFeedbackMessage').text_content()
        if attempt==0:
            assert page.locator('[data-footer-action="deep-hint"]').count()==0
        else:
            assert page.locator('[data-footer-action="deep-hint"]').count()==1
            page.locator('[data-footer-action="deep-hint"]').dispatch_event('click')
            assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
        page.locator('[data-footer-action="deep-retry"]').dispatch_event('click')
    assert page.locator('.gln-deep-hints p').count()==1

    # 使用上移按钮调整为正确顺序。
    correct_order=page.evaluate("""()=>KGGuidedLearningData.activitiesForNode('application-deep-recall')[0].reasoningTask.correctOrder""")
    for target_index, item_id in enumerate(correct_order):
        while True:
            current=page.evaluate("""()=>Array.from(document.querySelectorAll('[data-deep-order]')).map(el=>el.dataset.deepOrder)""")
            current_index=current.index(item_id)
            if current_index==target_index: break
            page.locator(f'[data-deep-order="{item_id}"] [data-deep-move="up"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="continue"]').count()==1
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-complete').count()==1
    metrics=page.evaluate("KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes['application-deep-recall'].metrics")
    assert metrics['totalAttempts']==11 and metrics['correctAttempts']==5
    assert metrics['hintUsedCount']==3
    assert page.locator('.gln-result-grid strong').nth(0).text_content()=='45%'
    page.close()



def test_knowledge_graph(browser):
    page=new_node_page(browser,'integration-rule',9)
    assert page.locator('.gln-kg-steps').count()==1
    assert page.locator('.gln-kg-board').count()==1
    assert page.locator('.gln-kg-node').count()==7
    assert page.locator('.gln-kg-edge-label').count()==7
    assert page.locator('[data-kg-option]').count()==4
    assert page.locator('.gln-kg-node.is-missing').count()==1

    # 补全知识点：首次答错后进入队尾，并开放第一条提示。
    page.locator('[data-kg-option="roles"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="error"]').count()==1
    assert page.locator('[data-footer-action="kg-hint"]').count()==1
    page.locator('[data-footer-action="kg-hint"]').dispatch_event('click')
    assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="kg-retry"]').dispatch_event('click')
    assert page.locator('.gln-kg-hints p').count()==1
    page.locator('[data-kg-option="impact"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="success"]').count()==1
    page.locator('[data-footer-action="kg-next"]').dispatch_event('click')

    # 第一项关系先答错，再通过提示完成。
    assert '敏捷迭代与关键角色' in page.locator('.gln-question-head h2').text_content()
    assert page.locator('.gln-kg-edge-label.is-highlight').text_content()=='？'
    page.locator('[data-kg-option="requires-approval"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="kg-hint"]').count()==1
    page.locator('[data-footer-action="kg-hint"]').dispatch_event('click')
    assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="kg-retry"]').dispatch_event('click')

    # 答错的第一项已进入队尾，先完成第二项关系。
    assert '正式基准与影响评估' in page.locator('.gln-question-head h2').text_content()
    page.locator('[data-kg-option="requires"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    page.locator('[data-footer-action="kg-next"]').dispatch_event('click')

    # 第一项关系从队尾再次出现，使用已显示的提示完成。
    assert '敏捷迭代与关键角色' in page.locator('.gln-question-head h2').text_content()
    assert page.locator('.gln-kg-hints p').count()==1
    page.locator('[data-kg-option="emphasizes"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    page.locator('[data-footer-action="kg-next"]').dispatch_event('click')

    # 错误连接：先选一条正确关系，再找出真正错误连接。
    assert page.locator('[data-kg-error-edge]').count()==7
    page.locator('[data-kg-error-edge="candidate-agile-roles"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="kg-hint"]').count()==1
    page.locator('[data-footer-action="kg-hint"]').dispatch_event('click')
    assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="kg-retry"]').dispatch_event('click')
    page.locator('[data-kg-error-edge="candidate-predictive-impact"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="continue"]').count()==1
    page.locator('[data-footer-action="continue"]').dispatch_event('click')

    assert page.locator('.gln-complete').count()==1
    metrics=page.evaluate("KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes['integration-rule'].metrics")
    assert metrics['totalAttempts']==7 and metrics['correctAttempts']==4
    assert metrics['accuracy']==57 and metrics['hintUsedCount']==3
    assert page.locator('.gln-result-grid strong').nth(0).text_content()=='57%'
    page.close()



def test_multi_induction(browser):
    page=new_node_page(browser,'application-induction',10)
    assert page.locator('.gln-induction-steps').count()==1
    assert page.locator('[data-induction-choice]').count()==4

    # 第一题先答错，验证原题进入队尾。
    first_stem=page.locator('.gln-question-head h2').text_content()
    wrong=page.evaluate("""stem=>{const a=KGGuidedLearningData.activitiesForNode('application-induction')[0];const q=a.sourceQuestions.find(item=>item.stem===stem);return q.options.find(option=>!option.correct).id}""",first_stem)
    page.locator(f'[data-induction-choice="{wrong}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="error"]').count()==1
    page.locator('[data-footer-action="induction-next"]').dispatch_event('click')

    # 依次完成队列中的三道题；答错的第一题会在队尾再次出现。
    completed=0
    while page.locator('[data-induction-choice]').count():
        stem=page.locator('.gln-question-head h2').text_content()
        correct=page.evaluate("""stem=>{const a=KGGuidedLearningData.activitiesForNode('application-induction')[0];const q=a.sourceQuestions.find(item=>item.stem===stem);return q.options.find(option=>option.correct).id}""",stem)
        page.locator(f'[data-induction-choice="{correct}"]').dispatch_event('click');page.locator('[data-footer-action="check"]').dispatch_event('click')
        completed+=1
        page.locator('[data-footer-action="induction-next"]').dispatch_event('click')
        if completed>4: raise AssertionError('原题队列未正确结束')
    assert completed==3
    assert page.locator('.gln-induction-canvas').count()==1

    mapping=page.evaluate("""()=>{const a=KGGuidedLearningData.activitiesForNode('application-induction')[0];return {cards:a.classificationTask.cards.map(c=>({id:c.id,correct:c.correctCategoryId})),categories:a.classificationTask.categories.map(c=>c.id)}}""")
    # 先故意全部错分，只反馈错误数量，不暴露具体卡片。
    for card in mapping['cards']:
        wrong_category=next(category for category in mapping['categories'] if category!=card['correct'])
        page.locator(f'[data-induction-card="{card["id"]}"]').dispatch_event('click')
        page.locator(f'[data-induction-zone="{wrong_category}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert '3 张题目卡片分类错误' in page.locator('#glnFeedbackMessage').text_content()
    page.locator('[data-footer-action="induction-retry"]').dispatch_event('click')

    # 正确分类三张卡片。
    for card in mapping['cards']:
        page.locator(f'[data-induction-card="{card["id"]}"]').dispatch_event('click')
        page.locator(f'[data-induction-zone="{card["correct"]}"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('#glnFeedback[data-kind="success"]').count()==1
    page.locator('[data-footer-action="induction-next"]').dispatch_event('click')
    assert page.locator('[data-induction-order]').count()==5

    # 排序连续答错 2 次、4 次后分别开放一级、二级提示。
    for attempt in range(4):
        page.locator('[data-footer-action="check"]').dispatch_event('click')
        if attempt in (1,3):
            assert page.locator('[data-footer-action="induction-hint"]').count()==1
            page.locator('[data-footer-action="induction-hint"]').dispatch_event('click')
            assert '提示：' in page.locator('#glnFeedbackMessage').text_content()
        else:
            assert page.locator('[data-footer-action="induction-hint"]').count()==0
        page.locator('[data-footer-action="induction-retry"]').dispatch_event('click')

    correct_order=page.evaluate("""()=>KGGuidedLearningData.activitiesForNode('application-induction')[0].orderingTask.correctOrder""")
    for target_index,item_id in enumerate(correct_order):
        while True:
            current=page.evaluate("""()=>Array.from(document.querySelectorAll('[data-induction-order]')).map(el=>el.dataset.inductionOrder)""")
            current_index=current.index(item_id)
            if current_index==target_index: break
            page.locator(f'[data-induction-order="{item_id}"] [data-induction-move="up"]').dispatch_event('click')
    page.locator('[data-footer-action="check"]').dispatch_event('click')
    assert page.locator('[data-footer-action="continue"]').count()==1
    page.locator('[data-footer-action="continue"]').dispatch_event('click')
    assert page.locator('.gln-complete').count()==1
    metrics=page.evaluate("KGGuidedLearningStore.read(KGGuidedLearningData.getCourse(),'browser-test').nodes['application-induction'].metrics")
    assert metrics['totalAttempts']==11 and metrics['correctAttempts']==5
    assert metrics['hintUsedCount']==2
    assert page.locator('.gln-result-grid strong').nth(0).text_content()=='45%'
    page.close()


BROWSER_ARGS=[
    '--no-sandbox','--disable-dev-shm-usage',
    '--in-process-gpu','--disable-gpu-sandbox','--use-gl=swiftshader',
    '--disable-crash-reporter','--disable-breakpad','--noerrdialogs'
]

def run_browser_case(playwright,name,test):
    print(name,flush=True)
    browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=BROWSER_ARGS)
    try:
        test(browser)
    finally:
        browser.close()

CASE_LIST=[
    ('test_path',test_path),
    ('test_admin_access',test_admin_access),
    ('test_path_position_memory',test_path_position_memory),
    ('test_placement_test',test_placement_test),
    ('test_keyword',test_keyword),
    ('test_choice',test_choice_completion_metrics),
    ('test_matching',test_matching),
    ('test_mixed_process',test_mixed_process_node),
    ('test_structure_hint',test_structure_retry_hint),
    ('test_part_challenge',test_part_challenge),
    ('test_memory',test_memory_match),
    ('test_deep_recall',test_deep_recall),
    ('test_knowledge_graph',test_knowledge_graph),
    ('test_multi_induction',test_multi_induction)
]
CASE_MAP=dict(CASE_LIST)

if __name__=='__main__':
    mode=os.environ.get('KG_BROWSER_TEST_MODE','smoke')
    only=os.environ.get('KG_BROWSER_CASE','').strip()

    with sync_playwright() as p:
        if mode=='matrix':
            print('test_desktop_entry_matrix',flush=True)
            browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=BROWSER_ARGS)
            test_desktop_entry_matrix(browser)
            print('browser-matrix-ok',flush=True)
            os._exit(0)

        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=BROWSER_ARGS)
        if only:
            test=CASE_MAP.get(only)
            if not test:raise SystemExit('Unknown browser case: '+only)
            print(only,flush=True)
            test(browser)
        else:
            critical=[
                ('test_path',test_path),
                ('test_placement_test',test_placement_test),
                ('test_part_challenge',test_part_challenge)
            ]
            for name,test in critical:
                print(name,flush=True)
                test(browser)
        print('browser-smoke-ok',flush=True)
        # Avoid intermittent Chromium shutdown hangs in restricted containers.
        os._exit(0)
