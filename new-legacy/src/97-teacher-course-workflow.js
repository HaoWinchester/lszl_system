'use strict';

(function(){
  const params=new URLSearchParams(location.search);
  const requestedMode=params.get('mode')||document.body?.dataset?.caWorkflowMode||'';
  const mode=requestedMode==='advanced'?'advanced':'simple';
  const byId=id=>document.getElementById(id);
  const scrollToId=id=>byId(id)?.scrollIntoView({behavior:'smooth',block:'start'});

  function updateSimpleLabels(){
    const replacements={
      caNodeActivityCount:text=>text.replace(/个活动/g,'项内容'),
      caEditorTitle:text=>text.replace('部分设置','章节设置').replace('节点设置','学习步骤设置'),
    };
    Object.entries(replacements).forEach(([id,fn])=>{const node=byId(id);if(!node)return;const next=fn(node.textContent);if(next!==node.textContent)node.textContent=next});
    document.querySelectorAll('#caStructureTree small').forEach(node=>{const next=node.textContent.replace(/个活动/g,'项内容');if(next!==node.textContent)node.textContent=next});
    document.querySelectorAll('#caActivityPicker [data-add-activity]').forEach(button=>{if(button.textContent!=='＋ 加入学习步骤')button.textContent='＋ 加入学习步骤'});
    document.querySelectorAll('#caAssignedActivities .ca-empty').forEach(node=>{const next=node.textContent.replace('当前节点尚未引用活动。','当前学习步骤还没有内容。');if(next!==node.textContent)node.textContent=next});
    const title=byId('caEditorTitle');if(title){const next=title.textContent.replace('部分设置','章节设置').replace('节点设置','学习步骤设置');if(next!==title.textContent)title.textContent=next}
  }
  function updateEffectiveWidth(){
    const width=Math.max(320,document.documentElement.clientWidth||window.innerWidth||0);
    document.documentElement.style.setProperty('--ca-effective-width',width+'px');
    document.body.classList.toggle('ca-effective-narrow',width<1180);
    document.body.classList.toggle('ca-effective-stack',width<820);
  }
  function watchEffectiveWidth(){
    updateEffectiveWidth();
    const observer=new ResizeObserver(updateEffectiveWidth);observer.observe(document.documentElement);
    const styleObserver=new MutationObserver(updateEffectiveWidth);styleObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
    window.addEventListener('resize',updateEffectiveWidth,{passive:true});
    window.visualViewport?.addEventListener('resize',updateEffectiveWidth,{passive:true});
  }
  function configureSimple(){
    document.body.classList.add('ca-simple-mode');
    watchEffectiveWidth();
    const advanced=byId('caAdvancedModeLink');if(advanced)advanced.href='course-admin.html?mode=advanced';
    document.querySelectorAll('[data-ca-step-target]').forEach(button=>button.addEventListener('click',()=>scrollToId(button.dataset.caStepTarget)));
    document.querySelector('[data-ca-step-action="publish"]')?.addEventListener('click',()=>byId('caPublishBtn')?.click());
    const observer=new MutationObserver(updateSimpleLabels);
    ['caStructureTree','caEditorTitle','caNodeActivityCount','caActivityPicker','caAssignedActivities'].forEach(id=>{const node=byId(id);if(node)observer.observe(node,{subtree:true,childList:true,characterData:true})});
    updateSimpleLabels();
  }
  function configureAdvanced(){
    document.body.classList.add('ca-advanced-mode');
    const link=byId('caAdvancedModeLink');if(link){link.textContent='返回简化课程设置';link.href='course-admin.html?mode=simple'}
    const requested=params.get('view');
    if(['courses','tasks'].includes(requested)){setTimeout(()=>document.querySelector(`[data-config-view="${requested}"]`)?.click(),0)}
  }
  document.addEventListener('DOMContentLoaded',()=>mode==='simple'?configureSimple():configureAdvanced());
})();
