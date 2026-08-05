#!/usr/bin/env python3
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
VIEWPORTS = ((1440, 900), (1366, 768), (1024, 768))
ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
ICON_ADAPTER = ROOT / 'src/109-focus-vega-ui-icons.js'
RUNTIME_AUTH = """() => {
  const username='teacher-runtime';
  localStorage.setItem('kg_local_current_user_v1',username);
  localStorage.setItem('kg_local_users_v1',JSON.stringify({
    [username]:{username,displayName:'运行时教师',role:'teacher',status:'active',subject:'PMP',salt:'x',hash:'x'}
  }));
  localStorage.setItem('kg_question_banks_v1__user__teacher-runtime',JSON.stringify([{
    id:'runtime-bank',name:'运行时长文本题库',subject:'PMP',questions:[{
      id:'runtime-question',title:'这是一道用于验证教师端运行时长文本样式与抽屉布局的题目标题',
      teacherNumber:'Q-RUNTIME-001',type:'single',difficulty:'medium',
      metadata:{knowledge:{taxonomyId:'taxonomy-pmp-main',primaryNodeId:'kp-pmp-agile'}}
    }]
  }]));
  window.confirm=()=>true;window.alert=()=>{};
}"""
CASES = {
    'teacher-workbench.html': {
        'anchors': ('.tw-topbar', '.tw-workflow', '.wb-main', '.wb-hero'),
        'panels': ('.wb-hero-copy', '.wb-next', '.wb-metric', '.wb-tip'),
        'title': '.wb-hero-copy h1',
        'primary': '.wb-next-action',
        'accent': '.wb-next-action',
        'accent_min_width': 60,
    },
    'question-bank.html': {
        'anchors': ('.qb-app', '.qb-layout', '.qb-editor', '.qb-workspace-card'),
        'panels': ('.qb-workspace-card', '.qb-management-section', '.qb-subject-strip'),
        'title': '.qb-brand h1',
        'primary': '#qbAddBankBtn',
        'accent': '.qb-main-tabs button.active',
        'body_classes': ('qb-simple-mode', 'qb-question-step'),
    },
    'paper-management.html': {
        'anchors': (
            '.pm-app', '.pm-paper-library-layout', '.pm-question-workbench',
            '#qbPaperList.pm-paper-list',
        ),
        'panels': ('.pm-page-head', '.pm-paper-workspace', '.pm-paper-list-section'),
        'title': '.pm-page-head h1',
        'primary': '#qbAddPaperBtn',
        'accent': '#qbPublishPaperBtn',
    },
    'course-admin.html': {
        'anchors': ('.ca-app', '.ca-layout', '.ca-structure', '.ca-node-editor', '.ca-library'),
        'panels': ('.ca-structure', '.ca-node-editor', '.ca-library', '.ca-preview'),
        'title': '.tw-command-title h1',
        'primary': '#caAddStageBtn',
        'accent': '#caPublishBtn',
        'body_classes': ('ca-simple-mode',),
    },
    'content-center.html': {
        'anchors': (
            '.cc-app', '.cc-layout', '.cc-tree-panel', '.cc-library-panel',
            '.cc-organize-panel', '.cc-inspector',
        ),
        'panels': ('.cc-tree-panel', '.cc-library-panel', '.cc-organize-panel', '.cc-inspector'),
        'title': '.tw-command-title h1',
        'primary': '#ccAddRootBtn',
        'accent': '#ccAddRootBtn',
    },
    'content-center.html?embed=knowledge': {
        'source': 'content-center.html',
        'anchors': ('.cc-app', '.cc-layout', '.cc-tree-panel', '.cc-inspector'),
        'panels': (),
        'title': '.cc-panel-title h2',
        'title_size': 20,
        'title_weight': 600,
        'primary': '#ccAddRootBtn',
        'accent': '#ccAddRootBtn',
        'embedded': True,
    },
}


def stylesheet_hrefs(html):
    return [
        match.group(1)
        for match in re.finditer(r'<link\b[^>]*\bhref=["\']([^"\']+\.css)["\'][^>]*>', html, re.I)
    ]


def frozen_signature(page):
    return page.evaluate(
        """() => {
          const selector=[
            '.tw-user','#authStatus','#userCenterModal','.user-center-backdrop',
            '#userSubscriptionDetailModal','[data-freeze-probe]'
          ].join(',');
          const properties=[
            'fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor',
            'borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','display'
          ];
          return [...document.querySelectorAll(selector)].map((element,index)=>{
            const style=getComputedStyle(element);
            return {
              key:`${element.id||element.className||'probe'}-${index}`,
              html:element.outerHTML,
              style:Object.fromEntries(properties.map(name=>[name,style[name]]))
            };
          });
        }"""
    )


def mount(page, case_name, spec):
    filename = spec.get('source', case_name)
    html = (ROOT / filename).read_text(encoding='utf-8')
    body_match = re.search(r'<body([^>]*)>([\s\S]*)</body>', html, re.I)
    if not body_match:
        raise AssertionError(f'{case_name}: body missing')
    body = re.sub(r'<script[\s\S]*?</script>', '', body_match.group(2), flags=re.I)
    html_attrs = ' class="kg-embedded" data-embed-mode="knowledge"' if spec.get('embedded') else ''
    page.set_content(
        f'<!doctype html><html{html_attrs}><head></head><body{body_match.group(1)}>{body}</body></html>'
    )
    if spec.get('body_classes'):
        page.evaluate('(classes) => document.body.classList.add(...classes)', list(spec['body_classes']))

    hrefs = stylesheet_hrefs(html)
    if hrefs[-2:] != ['styles/focus-vega-typography.css', 'styles/focus-vega-teacher.css']:
        raise AssertionError(f'{case_name}: final stylesheet order {hrefs[-2:]}')
    for href in hrefs[:-1]:
        page.add_style_tag(content=(ROOT / href).read_text(encoding='utf-8'))
    page.add_style_tag(content='*{transition:none!important;animation:none!important}')

    inject_fixtures(page, filename)
    before = frozen_signature(page)
    page.add_style_tag(content=(ROOT / hrefs[-1]).read_text(encoding='utf-8'))
    page.add_script_tag(content=ICON_ADAPTER.read_text(encoding='utf-8'))
    page.evaluate(
        """async () => {
          if(document.fonts?.ready)await document.fonts.ready;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }"""
    )
    after = frozen_signature(page)
    if after != before:
        raise AssertionError(f'{case_name}: frozen account/membership styles or DOM changed')


def inject_fixtures(page, filename):
    page.evaluate(
        """() => {
          const probe=document.createElement('div');
          probe.id='userCenterModal';probe.className='kg-user-center-modal';
          probe.hidden=true;probe.dataset.freezeProbe='user-center';
          probe.innerHTML='<section class="uc-panel"><button>账号操作</button><input value="账号资料"></section>';
          document.body.appendChild(probe);
          const subscription=document.createElement('div');
          subscription.id='userSubscriptionDetailModal';subscription.className='kg-subscription-modal';
          subscription.hidden=true;subscription.dataset.freezeProbe='subscription';
          subscription.innerHTML='<button class="payment-action">购买会员</button><div class="wechat-login">微信登录</div>';
          document.body.appendChild(subscription);
        }"""
    )
    if filename == 'paper-management.html':
        page.evaluate(
            """() => {
              const list=document.querySelector('#qbPaperList');
              for(let index=0;index<3;index+=1){
                const card=document.createElement('button');
                card.className='qb-list-item paper';
                card.innerHTML=`<span>${index+1}</span><strong>试卷 ${index+1}</strong><small>草稿 · 0 道题</small>`;
                list.appendChild(card);
              }
            }"""
        )


def visible_box(page, case_name, selector, width, height):
    locator = page.locator(selector)
    count = locator.count()
    if count != 1:
        raise AssertionError(f'{case_name} {width}x{height}: expected one {selector}, found {count}')
    box = locator.bounding_box()
    if not box or box['width'] <= 0.5 or box['height'] <= 0.5:
        raise AssertionError(f'{case_name} {width}x{height}: invisible {selector}')
    if box['x'] < -2 or box['x'] + box['width'] > width + 2:
        raise AssertionError(f'{case_name} {width}x{height}: viewport overflow {selector} {box}')
    return box


def inspect_semantics(page, case_name, spec, width, height):
    result = page.evaluate(
        """({titleSelector,panelSelectors,embedded}) => {
          const visible=element=>{
            for(let current=element;current;current=current.parentElement){
              const style=getComputedStyle(current);
              if(current.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<=0)return false;
            }
            const box=element.getBoundingClientRect();return box.width>.5&&box.height>.5;
          };
          const frozen=[
            '.tw-user','#authStatus','#userCenterModal','.user-center-backdrop',
            '#userSubscriptionDetailModal','[data-freeze-probe]'
          ].join(',');
          const iconOnly=[
            '[data-ui-icon]','.pm-icon-btn','.wsp-control','.qb-question-icon-action',
            '.cc-map-node-actions button','.cc-tree-row>button:last-child',
            '.ca-tree-toggle','.ca-assigned-item .order button','.row-actions button',
            '.cc-zoom button','.qb-question-pager button','button[aria-label="关闭"]'
          ].join(',');
          const directText=element=>[...element.childNodes]
            .filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
          const textFailures=[];const weightFailures=[];
          for(const element of document.body.querySelectorAll('*')){
            const text=directText(element);
            if(!text||!visible(element)||element.closest(frozen)||element.matches('[aria-hidden="true"]'))continue;
            const style=getComputedStyle(element),size=parseFloat(style.fontSize),weight=Number(style.fontWeight);
            const after=getComputedStyle(element,'::after');
            const generated=after.content&&after.content!=='none'&&after.content!=='normal';
            const effectiveSize=size<1&&generated?parseFloat(after.fontSize):size;
            const effectiveWeight=size<1&&generated?Number(after.fontWeight):weight;
            if(effectiveSize<12)textFailures.push(`${element.tagName.toLowerCase()}.${element.className||''}:${effectiveSize}:${text.slice(0,18)}`);
            if(![400,500,600,700].includes(effectiveWeight))weightFailures.push(`${element.tagName.toLowerCase()}.${element.className||''}:${effectiveWeight}`);
          }
          const controlFailures=[];
          for(const element of document.querySelectorAll('button,a,input,select,textarea')){
            if(!visible(element)||element.closest(frozen)||element.matches(iconOnly)||element.closest(iconOnly))continue;
            if(element.matches('input[type="checkbox"],input[type="radio"],input[type="file"],input[hidden]'))continue;
            const box=element.getBoundingClientRect(),style=getComputedStyle(element);
            if((element.matches('button,input,select')||element.getAttribute('role')==='button')&&box.height<35.5){
              controlFailures.push(`${element.tagName.toLowerCase()}#${element.id||''}.${element.className||''}:${box.height}`);
            }
            if(parseFloat(style.fontSize)<14)controlFailures.push(`${element.tagName.toLowerCase()}#${element.id||''}:font-${style.fontSize}`);
          }
          const title=getComputedStyle(document.querySelector(titleSelector));
          const primary=document.createElement('i');primary.style.color='var(--teacher-primary)';document.body.appendChild(primary);
          const panels=panelSelectors.flatMap(selector=>[...document.querySelectorAll(selector)]).filter(visible).map(panel=>{
            const style=getComputedStyle(panel);return {selector:panel.className,radius:style.borderRadius,border:style.borderColor};
          });
          const metrics={
            background:getComputedStyle(document.body).backgroundColor,
            primary:getComputedStyle(primary).color,
            titleSize:parseFloat(title.fontSize),titleWeight:Number(title.fontWeight),
            rootOverflow:Math.max(document.documentElement.scrollWidth-document.documentElement.clientWidth,document.body.scrollWidth-document.body.clientWidth),
            iconSlots:document.querySelectorAll('[data-ui-icon]').length,
            hydratedIcons:document.querySelectorAll('[data-ui-icon][data-ui-icon-ready] svg.focus-vega-ui-icon use').length,
            panels,textFailures:textFailures.slice(0,12),weightFailures:weightFailures.slice(0,12),
            controlFailures:controlFailures.slice(0,12),
          };
          primary.remove();
          if(embedded){
            const layout=getComputedStyle(document.querySelector('.cc-layout'));
            const tree=getComputedStyle(document.querySelector('.cc-tree-panel'));
            metrics.embedded={
              topbar:getComputedStyle(document.querySelector('.tw-topbar')).display,
              layoutDisplay:layout.display,layoutPadding:layout.padding,
              treeRadius:tree.borderRadius,treeBorder:tree.borderTopWidth,
            };
          }
          return metrics;
        }""",
        {
            'titleSelector': spec['title'],
            'panelSelectors': list(spec['panels']),
            'embedded': bool(spec.get('embedded')),
        },
    )
    failures = []
    if not spec.get('embedded') and result['background'] != 'rgb(250, 250, 250)':
        failures.append(f"background={result['background']}")
    if result['primary'] != 'rgb(109, 93, 252)':
        failures.append(f"primary={result['primary']}")
    expected_title_size = spec.get('title_size', 28)
    expected_title_weight = spec.get('title_weight', 700)
    if result['titleSize'] != expected_title_size or result['titleWeight'] != expected_title_weight:
        failures.append(f"title={result['titleSize']}/{result['titleWeight']}")
    if result['rootOverflow'] > 2:
        failures.append(f"root-overflow={result['rootOverflow']}")
    if result['iconSlots'] < 1 or result['hydratedIcons'] != result['iconSlots']:
        failures.append(f"icons={result['hydratedIcons']}/{result['iconSlots']}")
    for panel in result['panels']:
        if panel['radius'] != '10px' or panel['border'] != 'rgb(228, 228, 231)':
            failures.append(f'panel={panel}')
    if result['textFailures']:
        failures.append(f"sub-12={result['textFailures']}")
    if result['weightFailures']:
        failures.append(f"weights={result['weightFailures']}")
    if result['controlFailures']:
        failures.append(f"controls={result['controlFailures']}")
    if spec.get('embedded') and result.get('embedded') != {
        'topbar': 'none', 'layoutDisplay': 'block', 'layoutPadding': '0px',
        'treeRadius': '0px', 'treeBorder': '0px',
    }:
        failures.append(f"embedded={result.get('embedded')}")
    if failures:
        raise AssertionError(f'{case_name} {width}x{height}: ' + '; '.join(failures))


def inspect_primary(page, case_name, selector, width, height):
    page.locator(selector).scroll_into_view_if_needed()
    result = page.eval_on_selector(
        selector,
        """element => {
          const box=element.getBoundingClientRect();
          const x=Math.max(0,Math.min(innerWidth-1,box.left+box.width/2));
          const y=Math.max(0,Math.min(innerHeight-1,box.top+Math.min(box.height/2,18)));
          const hit=document.elementFromPoint(x,y);
          return {box:{x:box.x,y:box.y,width:box.width,height:box.height},disabled:Boolean(element.disabled),hit:Boolean(hit&&(hit===element||element.contains(hit)))};
        }""",
    )
    box = result['box']
    if box['width'] <= 0 or box['height'] < 35.5 or result['disabled'] or not result['hit']:
        raise AssertionError(f'{case_name} {width}x{height}: unusable primary {selector} {result}')


def inspect_accent(page, case_name, selector, min_width, width, height):
    result = page.eval_on_selector(
        selector,
        """element => {
          const style=getComputedStyle(element);
          const box=element.getBoundingClientRect();
          return {
            background:style.backgroundColor,image:style.backgroundImage,color:style.color,
            width:box.width,height:box.height,lineHeight:parseFloat(style.lineHeight),
          };
        }""",
    )
    expected_colors = (
        result['background'] == 'rgb(109, 93, 252)'
        and result['image'] == 'none'
        and result['color'] == 'rgb(255, 255, 255)'
    )
    single_line = result['height'] <= max(40, result['lineHeight'] * 2.1)
    if not expected_colors or result['width'] < min_width or not single_line:
        raise AssertionError(f'{case_name} {width}x{height}: inconsistent accent {selector} {result}')


def inspect_course_header(page, case_name, width, height):
    if not case_name.startswith('course-admin.html'):
        return
    result = page.evaluate(
        """() => {
          const copy=document.querySelector('.ca-structure>.ca-panel-head>div:first-child');
          const title=copy.querySelector('h2');
          const titleStyle=getComputedStyle(title);
          return {
            copyWidth:copy.getBoundingClientRect().width,
            titleHeight:title.getBoundingClientRect().height,
            titleLineHeight:parseFloat(titleStyle.lineHeight),
          };
        }"""
    )
    if result['copyWidth'] < 100 or result['titleHeight'] > result['titleLineHeight'] * 2.1:
        raise AssertionError(f'{case_name} {width}x{height}: squeezed structure heading {result}')


def inspect_content_toolbar(page, case_name, width, height):
    if not case_name.startswith('content-center.html'):
        return
    result = page.evaluate(
        """() => {
          const box=selector=>{
            const rect=document.querySelector(selector).getBoundingClientRect();
            return {width:rect.width,height:rect.height};
          };
          return {
            zoom:box('#ccZoomControls'),out:box('[data-zoom="out"]'),
            incoming:box('[data-zoom="in"]'),reset:box('[data-zoom="reset"]'),
            activeView:getComputedStyle(document.querySelector('.cc-view-tabs button.active')).backgroundColor,
            rootDrop:(()=>{const style=getComputedStyle(document.querySelector('.cc-root-drop'));return {background:style.backgroundColor,border:style.borderColor,color:style.color};})(),
            organizeHelp:(()=>{const element=document.querySelector('.cc-org-help');if(!element)return null;const style=getComputedStyle(element);return {background:style.backgroundColor,border:style.borderColor,accent:getComputedStyle(element.querySelector('strong')).color};})(),
          };
        }"""
    )
    expected_soft = {'background': 'rgb(248, 247, 255)', 'border': 'rgb(221, 214, 254)', 'color': 'rgb(109, 93, 252)'}
    help_ok = result['organizeHelp'] is None or result['organizeHelp'] == {
        'background': expected_soft['background'], 'border': expected_soft['border'], 'accent': expected_soft['color'],
    }
    if (
        result['zoom']['height'] > 40 or result['reset']['height'] > 40
        or result['out']['width'] > 40 or result['incoming']['width'] > 40
        or result['activeView'] != 'rgb(109, 93, 252)'
        or result['rootDrop'] != expected_soft or not help_ok
    ):
        raise AssertionError(f'{case_name} {width}x{height}: wrapped zoom controls {result}')


def inspect_question_dialogs(page, case_name, width, height):
    if case_name != 'question-bank.html':
        return
    for selector in ('.tq-batch-classification-dialog', '.qb-classification-dialog'):
        result = page.eval_on_selector(
            selector,
            """dialog => {
              dialog.setAttribute('open','');
              const visible=element=>{
                for(let current=element;current&&current!==dialog.parentElement;current=current.parentElement){
                  const style=getComputedStyle(current);
                  if(current.hidden||style.display==='none'||style.visibility==='hidden')return false;
                }
                const box=element.getBoundingClientRect();return box.width>.5&&box.height>.5;
              };
              const failures=[];
              for(const element of dialog.querySelectorAll('*')){
                const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
                if(!text||!visible(element))continue;
                const style=getComputedStyle(element),size=parseFloat(style.fontSize),weight=Number(style.fontWeight);
                if(size<12||![400,500,600,700].includes(weight))failures.push(`${element.tagName}.${element.className}:${size}/${weight}:${text.slice(0,20)}`);
              }
              const controlFailures=[];
              for(const control of dialog.querySelectorAll('button,input,select,textarea')){
                if(!visible(control)||control.matches('input[type="checkbox"],input[type="radio"],[aria-label="关闭"]'))continue;
                const box=control.getBoundingClientRect(),style=getComputedStyle(control);
                if(box.height<35.5||parseFloat(style.fontSize)<14)controlFailures.push(`${control.tagName}#${control.id}:${box.height}/${style.fontSize}`);
              }
              const style=getComputedStyle(dialog),primary=dialog.querySelector('button.primary'),primaryStyle=getComputedStyle(primary);
              const result={
                box:dialog.getBoundingClientRect().toJSON(),radius:style.borderRadius,border:style.borderColor,
                primary:{background:primaryStyle.backgroundColor,color:primaryStyle.color},failures,controlFailures,
              };
              dialog.removeAttribute('open');
              return result;
            }""",
        )
        if (
            result['box']['width'] <= 0 or result['box']['height'] <= 0
            or result['box']['right'] > width + 2 or result['radius'] != '10px'
            or result['border'] != 'rgb(228, 228, 231)'
            or result['primary'] != {'background': 'rgb(109, 93, 252)', 'color': 'rgb(255, 255, 255)'}
            or result['failures'] or result['controlFailures']
        ):
            raise AssertionError(f'{case_name} {width}x{height}: unskinned business dialog {selector} {result}')


def inspect_content_dynamic_states(page, case_name, width, height):
    if not case_name.startswith('content-center.html'):
        return
    result = page.evaluate(
        """() => {
          const summary=document.querySelector('.cc-tree-summary');
          summary.innerHTML='<button class="cc-question-count-badge low">2 题</button>';
          const stats=document.createElement('div');stats.className='cc-inspector-stats';
          stats.innerHTML='<span>直接题量</span><button data-question-count-node>2 题</button>';
          document.querySelector('.cc-tree-panel').appendChild(stats);
          const drawer=document.querySelector('#ccQuestionCountDrawer');drawer.hidden=false;
          document.querySelector('#ccQuestionDrawerSummary').textContent='当前节点 2 题，含下级共 6 题';
          document.querySelector('#ccQuestionDrawerList').innerHTML='<article><div><strong>这是一道用于验证长文本状态的题目标题</strong><span>题库：项目管理训练</span><small>编号 Q-0001</small></div><a href="#">查看题目</a></article>';
          const roots=[summary,stats,drawer],failures=[];
          for(const root of roots)for(const element of root.querySelectorAll('*')){
            const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
            if(!text)continue;
            const style=getComputedStyle(element),size=parseFloat(style.fontSize),weight=Number(style.fontWeight);
            if(size<12||![400,500,600,700].includes(weight))failures.push(`${element.tagName}.${element.className}:${size}/${weight}:${text.slice(0,24)}`);
          }
          const drawerStyle=getComputedStyle(drawer),activeStyle=getComputedStyle(drawer.querySelector('.active'));
          const box=drawer.getBoundingClientRect();
          const badgeBox=summary.querySelector('.cc-question-count-badge').getBoundingClientRect();
          const nodeButtonBox=stats.querySelector('[data-question-count-node]').getBoundingClientRect();
          drawer.hidden=true;summary.innerHTML='';stats.remove();
          return {
            failures,box:box.toJSON(),radius:drawerStyle.borderRadius,border:drawerStyle.borderColor,
            active:{background:activeStyle.backgroundColor,color:activeStyle.color},
            badgeHeight:badgeBox.height,nodeButtonHeight:nodeButtonBox.height,
          };
        }"""
    )
    if (
        result['failures'] or result['box']['width'] <= 0 or result['box']['right'] > width + 2
        or result['radius'] != '10px' or result['border'] != 'rgb(228, 228, 231)'
        or result['active'] != {'background': 'rgb(109, 93, 252)', 'color': 'rgb(255, 255, 255)'}
        or result['badgeHeight'] < 35.5 or result['nodeButtonHeight'] < 35.5
    ):
        raise AssertionError(f'{case_name} {width}x{height}: unskinned dynamic content state {result}')


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        return


def runtime_text_failures(page, selector):
    return page.eval_on_selector(
        selector,
        """root => {
          const visible=element=>{
            for(let current=element;current;current=current.parentElement){
              const style=getComputedStyle(current);
              if(current.hidden||style.display==='none'||style.visibility==='hidden')return false;
            }
            const box=element.getBoundingClientRect();return box.width>.5&&box.height>.5;
          };
          const failures=[];
          for(const element of root.querySelectorAll('*')){
            const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
            if(!text||!visible(element))continue;
            const style=getComputedStyle(element),size=parseFloat(style.fontSize),weight=Number(style.fontWeight);
            if(size<12||![400,500,600,700].includes(weight))failures.push(`${element.tagName}.${element.className}:${size}/${weight}:${text.slice(0,28)}`);
          }
          return failures;
        }""",
    )


def runtime_legacy_magenta(page):
    return page.evaluate(
        """() => [...document.body.querySelectorAll('*')].filter(element=>{
          const box=element.getBoundingClientRect(),style=getComputedStyle(element);
          return box.width>.5&&box.height>.5
            &&!element.closest('.tw-user,#authStatus,#userCenterModal,.user-center-backdrop,#userSubscriptionDetailModal')
            &&(style.backgroundColor==='rgb(183, 11, 108)'||style.color==='rgb(183, 11, 108)');
        }).map(element=>({tag:element.tagName,id:element.id,classes:element.className,text:(element.innerText||'').trim().slice(0,36)}));"""
    )


def runtime_interaction_checks(browser):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietStaticHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    failures = []
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.add_init_script(f'({RUNTIME_AUTH})()')
        try:
            response = page.goto(f'{base}/question-bank.html?mode=simple&step=questions', wait_until='domcontentloaded')
            if not response or response.status != 200:
                failures.append(f'question runtime response={response.status if response else None}')
            page.wait_for_function("window.KGQuestionBankAdminAPI && document.querySelector('#qbKnowledgePickerBtn')")
            magenta = runtime_legacy_magenta(page)
            if magenta:
                failures.append(f'question legacy magenta={magenta}')
            page.locator('#qbKnowledgePickerBtn').dispatch_event('click')
            page.wait_for_function("document.querySelector('#qbKnowledgePickerDialog').open")
            dialog_failures = runtime_text_failures(page, '#qbKnowledgePickerDialog')
            if dialog_failures:
                failures.append(f'question classification dialog typography={dialog_failures}')
            dialog_style = page.eval_on_selector(
                '#qbKnowledgePickerDialog',
                """dialog=>{const style=getComputedStyle(dialog),button=getComputedStyle(dialog.querySelector('button.primary'));return {radius:style.borderRadius,border:style.borderColor,primary:button.backgroundColor};}""",
            )
            if dialog_style != {'radius': '10px', 'border': 'rgb(228, 228, 231)', 'primary': 'rgb(109, 93, 252)'}:
                failures.append(f'question classification dialog style={dialog_style}')
            page.locator('#qbKnowledgeSearchInput').fill('敏捷交付与运行时长文本检索')
            page.locator('#qbKnowledgePickerDialog button[value="cancel"]').first.click()
            page.locator('#tqBatchDefaultEditBtn').dispatch_event('click')
            page.wait_for_function("document.querySelector('#tqBatchClassificationDialog').open")
            batch_failures = runtime_text_failures(page, '#tqBatchClassificationDialog')
            if batch_failures:
                failures.append(f'question batch dialog typography={batch_failures}')
            page.locator('#tqBatchClassificationDialog button[value="cancel"]').first.click()
            if errors:
                failures.append(f'question runtime errors={errors}')
        except Exception as error:
            failures.append(f'question runtime exception={error}')
        finally:
            page.close()

        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.add_init_script(f'({RUNTIME_AUTH})()')
        try:
            response = page.goto(f'{base}/content-center.html', wait_until='domcontentloaded')
            if not response or response.status != 200:
                failures.append(f'content runtime response={response.status if response else None}')
            page.wait_for_function("window.KGKnowledgeQuestionStats && document.querySelectorAll('.cc-question-count-badge').length > 0")
            magenta = runtime_legacy_magenta(page)
            if magenta:
                failures.append(f'content legacy magenta={magenta}')
            compact_heights = page.locator('.cc-question-count-badge').evaluate_all(
                "elements=>elements.map(element=>element.getBoundingClientRect().height)"
            )
            node_heights = page.locator('[data-question-count-node]').evaluate_all(
                "elements=>elements.map(element=>element.getBoundingClientRect().height)"
            )
            if any(value < 35.5 for value in compact_heights + node_heights):
                failures.append(f'content runtime compact control heights={compact_heights}/{node_heights}')
            nonzero = page.locator('.cc-question-count-badge').filter(has_text='1')
            if nonzero.count() < 1:
                failures.append('content runtime did not render seeded question-count badges')
            else:
                nonzero.first.click()
                page.wait_for_function("!document.querySelector('#ccQuestionCountDrawer').hidden")
                drawer_failures = runtime_text_failures(page, '#ccQuestionCountDrawer')
                if drawer_failures:
                    failures.append(f'content drawer typography={drawer_failures}')
                if '运行时长文本样式' not in page.locator('#ccQuestionCountDrawer').inner_text():
                    failures.append('content drawer missing seeded long-text question')
                page.locator('#ccQuestionDrawerClose').click()
            page.locator('.cc-view-tabs [data-tree-view="list"]').click()
            page.wait_for_function('document.querySelector("[data-tree-view=\\"list\\"]").classList.contains("active")')
            page.locator('.cc-view-tabs [data-tree-view="graph"]').click()
            page.locator('#ccKnowledgeSearch').fill('敏捷')
            if errors:
                failures.append(f'content runtime errors={errors}')
        except Exception as error:
            failures.append(f'content runtime exception={error}')
        finally:
            page.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    if failures:
        raise AssertionError('focus-vega teacher runtime RED:\n- ' + '\n- '.join(failures))
    print('focus-vega-teacher-runtime-browser-ok 2/2')


def main():
    failures = []
    checks = 0
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ARGS}
        if Path('/usr/bin/chromium').exists():
            launch['executable_path'] = '/usr/bin/chromium'
        browser = playwright.chromium.launch(**launch)
        try:
            for width, height in VIEWPORTS:
                for case_name, spec in CASES.items():
                    checks += 1
                    page = browser.new_page(viewport={'width': width, 'height': height})
                    errors = []
                    page.on('pageerror', lambda error, target=errors: target.append(str(error)))
                    page.on('console', lambda message, target=errors: target.append(message.text) if message.type == 'error' else None)
                    try:
                        mount(page, case_name, spec)
                        for selector in spec['anchors']:
                            visible_box(page, case_name, selector, width, height)
                        inspect_semantics(page, case_name, spec, width, height)
                        inspect_primary(page, case_name, spec['primary'], width, height)
                        inspect_accent(page, case_name, spec['accent'], spec.get('accent_min_width', 80), width, height)
                        inspect_course_header(page, case_name, width, height)
                        inspect_content_toolbar(page, case_name, width, height)
                        inspect_question_dialogs(page, case_name, width, height)
                        inspect_content_dynamic_states(page, case_name, width, height)
                        if errors:
                            raise AssertionError(f'{case_name} {width}x{height}: browser errors {errors}')
                    except Exception as error:
                        failures.append(str(error))
                    finally:
                        page.close()
            runtime_interaction_checks(browser)
        finally:
            browser.close()
    if failures:
        raise AssertionError(
            f'focus-vega teacher RED: {len(failures)}/{checks} failing cases\n- '
            + '\n- '.join(failures[:18])
        )
    print(f'focus-vega-teacher-pc-browser-ok {checks}/{checks}')


if __name__ == '__main__':
    main()
