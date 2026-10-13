'use strict';
(function(global){
  const presets=[
    {id:'wire',name:'简洁线框',cardStyle:'rectangle',fillColor:'#ffffff',borderColor:'#94a3b8',textColor:'#0f172a',lineStyle:'solid',color:'#64748b'},
    {id:'blue',name:'蓝色圆角',cardStyle:'rounded',fillColor:'#dbeafe',borderColor:'#3b82f6',textColor:'#1e3a8a',lineStyle:'solid',color:'#3b82f6'},
    {id:'branches',name:'彩色分支',cardStyle:'rounded',fillColor:'#dcfce7',borderColor:'#16a34a',textColor:'#14532d',lineStyle:'solid',color:'#16a34a'},
    {id:'mono',name:'黑白树形',cardStyle:'rectangle',fillColor:'#ffffff',borderColor:'#111111',textColor:'#111111',lineStyle:'solid',color:'#111111'},
    {id:'paper',name:'纸感便签',cardStyle:'sticky',fillColor:'#fef3c7',borderColor:'#d97706',textColor:'#78350f',lineStyle:'dashed',color:'#d97706'},
    {id:'capsule',name:'胶囊节点',cardStyle:'rounded',fillColor:'#f3e8ff',borderColor:'#a855f7',textColor:'#581c87',lineStyle:'solid',color:'#a855f7'}
  ];
  function apply(graph,{themeId,scopeIds,override=false,model=global.KGGraphModel}={}){
    const theme=presets.find(t=>t.id===themeId);if(!theme)throw new Error('未知系统主题');const ids=new Set(scopeIds||graph.nodes.map(n=>n.id));
    let branches=new Map();if(themeId==='branches'){try{const tree=global.KGGraphMindmapLayout.compute(graph,{rootIds:graph.mindmap?.rootIds||[],scopeIds:[...ids]});let index=0;for(const root of tree.rootIds){branches.set(root,0);for(const e of tree.treeEdges){if(e.from===root)branches.set(e.to,++index);else branches.set(e.to,branches.get(e.from)||0)}}}catch{graph.nodes.forEach((n,i)=>branches.set(n.id,i))}}
    for(const n of graph.nodes){if(!ids.has(n.id))continue;const current=model.appearanceOf(n),baseline=n.mindmapTheme?.baseline||model.defaultsForCardStyle(current.cardStyle),manual=n.manualAppearanceFields||[];const patch={cardStyle:theme.cardStyle,fillColor:theme.fillColor,borderColor:theme.borderColor,textColor:theme.textColor,fillOpacity:1,borderVisible:true,borderWidth:1,borderStyle:'solid',borderOpacity:1,textAlign:'center',fontSize:15,fontFamily:'system',fontWeight:'bold',fontStyle:'normal',underline:false,strikeThrough:false,lineHeight:1.25};
      if(themeId==='branches'){const colors=['#16a34a','#2563eb','#9333ea','#ea580c'];patch.fillColor=['#dcfce7','#dbeafe','#f3e8ff','#ffedd5'][(branches.get(n.id)||0)%4];patch.borderColor=colors[(branches.get(n.id)||0)%4]}
      const applied={};for(const [key,value] of Object.entries(patch)){const defaultValue=baseline[key]??model.DEFAULT_APPEARANCE[key];if(override||(!manual.includes(key)&&current[key]===defaultValue))applied[key]=value}
      // A preset surface is explicit, while per-field provenance protects later edits.
      n.manualAppearanceFields=override?[]:[...new Set([...manual,...Object.keys(patch).filter(k=>current[k]!== (baseline[k]??model.DEFAULT_APPEARANCE[k]))])];
      model.updateAppearance(n,{...applied,surfaceCustomized:true},{theme:true});n.mindmapTheme={id:themeId,baseline:{...current,...applied}};
    }
    for(const l of graph.links||[]){if(!ids.has(l.from)||!ids.has(l.to))continue;const old=l.mindmapTheme?.baseline||{color:graph.defaults?.linkColor||'#64748b',lineStyle:graph.defaults?.linkStyle||'solid',strokeWidth:4};const manual=new Set(override?[]:l.manualAppearanceFields||[]),patch={color:themeId==='branches'?['#16a34a','#2563eb','#9333ea','#ea580c'][(branches.get(l.to)||0)%4]:theme.color,lineStyle:theme.lineStyle,strokeWidth:2};for(const [k,v] of Object.entries(patch)){if(l[k]!=null&&l[k]!==old[k]&&!override)manual.add(k);if(override||!manual.has(k))l[k]=v}l.manualAppearanceFields=[...manual];l.mindmapTheme={id:themeId,baseline:{color:l.color,lineStyle:l.lineStyle,strokeWidth:l.strokeWidth}}}
    graph.mindmap={...(graph.mindmap||{}),themeId,schemaVersion:1};return theme;
  }
  function controls(host,{getGraph,getSelectedIds,runLayout,runTheme}){
    const panel=document.createElement('div');panel.dataset.mindmapControls='true';
    const graph=getGraph();panel.innerHTML='<div class="mm-row mm-layout-row"><label class="mm-field">作用范围 <select data-mm-scope><option value="all">整个当前图谱</option><option value="selected">仅选区</option></select></label><label class="mm-field">根节点 <select data-mm-root><option value="">已有层级根节点</option></select></label><label class="mm-field">布局 <select data-mm-direction><option value="right">向右</option><option value="left">向左</option><option value="bilateral">左右展开</option><option value="down">向下树形</option></select></label><button type="button" class="mm-apply" data-mm-layout>应用布局</button><label class="mm-field mm-override"><input type="checkbox" data-mm-override>覆盖手工样式</label><span data-mm-status role="status"></span></div><div class="mm-row mm-theme-row"></div>';
    const themeRow=panel.querySelector('.mm-theme-row');themeRow.prepend(Object.assign(document.createElement('span'),{className:'mm-caption',textContent:'主题'}));
    const root=panel.querySelector('[data-mm-root]');for(const n of graph.nodes){const o=document.createElement('option');o.value=n.id;o.textContent=global.KGGraphModel.contentOf(n).title;root.append(o)}root.value=graph.mindmap?.rootIds?.[0]||'';
    const scope=()=>{if(panel.querySelector('[data-mm-scope]').value==='all')return undefined;const ids=getSelectedIds();if(!ids.length)throw new Error('请先选择节点');return ids};
    const execute=work=>{try{work();panel.querySelector('[data-mm-status]').textContent='已应用'}catch(e){panel.querySelector('[data-mm-status]').textContent=e.message}};
    panel.querySelector('[data-mm-layout]').onclick=()=>execute(()=>runLayout({rootIds:root.value?[root.value]:[],direction:panel.querySelector('[data-mm-direction]').value,scopeIds:scope()}));
    for(const t of presets){
      const b=document.createElement('button');b.type='button';b.dataset.mmTheme=t.id;b.className='mm-theme-chip';b.textContent=t.name;
      // 芯片自带主题预览色（背景/文字/描边由主题数据注入）。
      b.style.cssText=`--chip-bg:${t.fillColor};--chip-fg:${t.textColor};--chip-border:${t.borderColor}`+(t.id==='capsule'?';--chip-radius:999px':'');
      b.onclick=()=>execute(()=>runTheme({themeId:t.id,scopeIds:scope(),override:panel.querySelector('[data-mm-override]').checked}));themeRow.append(b);
    }
    host.append(panel);return panel;
  }
  global.KGGraphMindmapThemes=Object.freeze({presets,apply,controls});if(typeof module!=='undefined')module.exports=global.KGGraphMindmapThemes;
})(typeof window!=='undefined'?window:globalThis);
