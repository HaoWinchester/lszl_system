/* Shared read-only preview and explicit new-file XMind import for both file tools. */
(function(global){
  'use strict';
  function warningLabel(code){return({'font-family':'字体','font-weight':'字重','inherited-style':'自动配色与继承','shape':'节点形状','line-geometry':'连线外观','style-property':'其他样式','style-value':'样式数值','layout':'布局','map-style':'主题配色','sheet-objects':'特殊对象','special-objects':'特殊对象','special-topics':'特殊主题','notes-format':'备注格式','title-format':'标题格式','relationship':'关系外观'})[code]||'兼容差异'}
  function groupWarnings(warnings){
    const groups=new Map();
    for(const warning of warnings){const key=warning.sheetId+'|'+warning.objectId;if(!groups.has(key))groups.set(key,{sheetTitle:warning.sheetTitle||'工作表',objectTitle:warning.objectTitle||'主题',warnings:[]});groups.get(key).warnings.push(warning)}
    return [...groups.values()];
  }
  function confirmation(preview,ids,accepted){
    if(!ids.length||ids.some(id=>!preview.sheets.some(sheet=>sheet.id===id)))throw new Error('请选择有效工作表。');
    const warnings=preview.warnings.filter(w=>ids.includes(w.sheetId));
    if(warnings.length&&!accepted)throw new Error('请明确接受所选工作表的全部保真差异，或取消。');
    return{sheetIds:ids,acceptedWarnings:warnings.map(w=>w.id)};
  }
  async function request(action,file,fields={}){
    const body=new FormData();body.append('file',file);
    for(const [key,value] of Object.entries(fields))body.append(key,JSON.stringify(value));
    const response=await fetch('/api/v1/graph-imports/xmind/'+action,{method:'POST',credentials:'same-origin',body});
    const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'导入请求失败，请检查登录、文件和确认选项。');
    return data;
  }
  function element(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el}
  let active=null;
  function open(file){
    if(active)throw new Error('请先完成或取消当前 XMind 预览。');
    if(!file||!/\.xmind$/i.test(file.name))throw new Error('请选择 .xmind 文件。');
    if(file.size>50*1024*1024)throw new Error('压缩文件超过 50 MiB。');
    return new Promise(resolve=>{
      const host=element('dialog');host.id='xmindImportDialog';host.setAttribute('aria-label','XMind 导入预览');
      Object.assign(host.style,{width:'min(760px,90vw)',maxHeight:'85vh',overflow:'auto',padding:'24px',border:'1px solid #cbd5e1',borderRadius:'16px'});
      const heading=element('h2','XMind 导入预览'),status=element('p','正在解析，预览不会写入文件…'),content=element('div'),actions=element('div');
      const cancel=element('button','取消'),submit=element('button','创建所选图谱');submit.id='xmindConfirm';submit.disabled=true;
      actions.append(cancel,submit);host.append(heading,status,content,actions);
      let cleanup=()=>{},busy=false,preview=null;active=host;
      const close=result=>{if(busy)return;cleanup();host.close();host.remove();active=null;resolve(result)};
      cancel.onclick=()=>close(null);host.addEventListener('cancel',event=>{event.preventDefault();close(null)});
      (document.fullscreenElement||document.body).append(host);
      if(global.KGCanvasDomInteraction?.mountOverlay)cleanup=global.KGCanvasDomInteraction.mountOverlay(host);
      host.showModal();
      const selected=()=>[...host.querySelectorAll('[data-xmind-sheet]:checked')].map(el=>el.value);
      request('preview',file).then(data=>{
        if(active!==host)return;preview=data;
        status.textContent=`识别为 ${data.format.toUpperCase()}，${data.sheets.length} 工作表。每表创建一个新文件，原图谱保留。`;
        content.append(element('p',data.compatibility),element('p',`每张图谱最多 ${data.quota.maxNodesPerSheet} 张卡牌；每次最多 ${data.quota.maxSheets} 张工作表。压缩文件最多 50 MiB，图片最多 5 MiB。`));
        for(const sheet of data.sheets){
          const label=element('label');label.style.display='block';const checkbox=element('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.value=sheet.id;checkbox.dataset.xmindSheet='true';
          label.append(checkbox,document.createTextNode(`${sheet.title||sheet.id}：${sheet.nodeCount} 主题、${sheet.imageCount} 图片、${sheet.notesCount} 备注 → ${sheet.name}`));content.append(label);
          content.append(element('p','标题抽样：'+sheet.sample.map(n=>n.title).join(' / ')));
        }
        const differences=element('details');differences.open=true;const summary=element('summary');differences.append(summary);const list=element('ul');Object.assign(list.style,{maxHeight:'240px',overflow:'auto'});differences.append(list);content.append(differences);
        const acceptanceLabel=element('label');acceptanceLabel.style.display='block';const accept=element('input');accept.type='checkbox';accept.id='xmindAcceptWarnings';acceptanceLabel.append(accept,document.createTextNode('我已查看并接受所选工作表下列全部近似和未映射项；这些差异不表示保真验收通过。'));content.append(acceptanceLabel);
        const update=()=>{
          const ids=selected(),warnings=data.warnings.filter(w=>ids.includes(w.sheetId));list.replaceChildren();
          summary.textContent=`所选工作表保真差异：${warnings.length} 项`;
          for(const group of groupWarnings(warnings)){
            const row=element('li'),topic=element('details'),caption=element('summary',`${group.sheetTitle} · ${group.objectTitle}：${[...new Set(group.warnings.map(w=>warningLabel(w.code)))].join('、')}`);topic.append(caption);
            const categories=new Map();for(const w of group.warnings){if(!categories.has(w.code))categories.set(w.code,[]);categories.get(w.code).push(w.detail)}
            for(const [code,details] of categories)topic.append(element('p',warningLabel(code)+'：'+details.join('；')));row.append(topic);list.append(row);
          }
          const diagnostics=element('details');diagnostics.append(element('summary','技术诊断记录'),element('pre',JSON.stringify(warnings,null,2)));list.append(diagnostics);
          submit.disabled=!ids.length||(warnings.length&&!accept.checked);
        };
        host.querySelectorAll('[data-xmind-sheet]').forEach(el=>el.addEventListener('change',()=>{accept.checked=false;update()}));accept.addEventListener('change',update);update();
      }).catch(error=>{if(active===host)status.textContent=error.message});
      submit.onclick=async()=>{
        if(busy||!preview)return;
        try{
          const fields=confirmation(preview,selected(),host.querySelector('#xmindAcceptWarnings').checked);
          busy=true;submit.disabled=true;cancel.disabled=true;status.textContent='正在原子创建文件和图片…';
          const result=await request('import',file,fields);busy=false;
          const store=global.KGGraphFileRemoteStore||global.KGGraphFileStore;
          try{if(store?.refresh)await store.refresh();if(global.KGGraphFileTabs?.refresh)await global.KGGraphFileTabs.refresh()}catch(error){console.error(error)}
          content.replaceChildren();heading.textContent='已创建可编辑图谱';status.textContent=`创建 ${result.files.length} 个文件。保真差异已记录，可从文件列表打开。`;
          for(const item of result.files){
            const link=element('a',item.file.name);link.dataset.xmindResult=item.file.id;link.href='index.html?fileId='+encodeURIComponent(item.file.id);
            link.onclick=async event=>{if(global.KGGraphFileTabs?.openFile){event.preventDefault();close(result);await global.KGGraphFileTabs.openFile(item.file.id)}};
            const p=element('p');p.append(link);content.append(p);
          }
          submit.hidden=true;cancel.disabled=false;cancel.textContent='关闭';cancel.onclick=()=>close(result);
          global.dispatchEvent(new CustomEvent('kg-xmind-imported',{detail:result}));
        }catch(error){busy=false;cancel.disabled=false;submit.disabled=false;status.textContent=error.message}
      };
    });
  }
  global.KGXMindImport={open,confirmation};
  if(typeof module==='object'&&module.exports)module.exports={confirmation,groupWarnings};
})(typeof window!=='undefined'?window:globalThis);
