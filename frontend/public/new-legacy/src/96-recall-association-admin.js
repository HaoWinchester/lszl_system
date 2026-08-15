'use strict';

/* V9.0-P3.5.5 科目级知识联想库集中管理（知识树页面） */
(function(global){
  const $=id=>document.getElementById(id);
  const clean=value=>String(value??'').trim();
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  let parsedPreview=null;
  let loadedSubjectCode='';

  function api(){return global.KGRecallAssociationLibrary||null}
  function contentCore(){return global.KGLearningContent||null}
  function currentSubject(){
    const core=contentCore();
    const subjectId=global.KGContentCenterApp?.getSubjectId?.()||'';
    const subject=core?.subjectById?.(subjectId)||core?.subjectById?.('PMP')||null;
    return {id:subject?.id||subjectId||'subject-pmp',code:clean(subject?.code||subjectId||'PMP').toUpperCase(),name:clean(subject?.name?.zh||subject?.code||subjectId||'PMP')};
  }
  function toast(message){
    if(global.KGContentCenterApp?.toast)return global.KGContentCenterApp.toast(message);
    const node=$('ccToast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2200);
  }
  function report(title,detail,state='info'){
    const node=$('ccRecallLibraryReport');if(!node)return;
    node.dataset.state=state;node.innerHTML=`<strong>${escapeHTML(title)}</strong><span>${escapeHTML(detail)}</span>`;
  }
  function updateMeta(library,subject=currentSubject()){
    const node=$('ccRecallLibraryMeta');if(!node)return;
    const updated=clean(library?.updatedAt);const updatedLabel=updated?new Date(updated).toLocaleString('zh-CN',{hour12:false}):'尚未保存';
    node.innerHTML=`<strong>${escapeHTML(subject.code)} · ${escapeHTML(subject.name)}</strong><span>${Number(library?.nodes?.length)||0} 个知识点 · ${Number(library?.edges?.length)||0} 条关系 · 更新于 ${escapeHTML(updatedLabel)}</span>`;
  }
  function loadCurrent({announce=false}={}){
    const libraryApi=api(),subject=currentSubject(),text=$('ccRecallLibraryText');
    if(!libraryApi||!text)return;
    const library=libraryApi.read(subject.code);
    text.value=libraryApi.toText(library);
    loadedSubjectCode=subject.code;parsedPreview=null;updateMeta(library,subject);
    report('已载入当前联想库',`${library.nodes.length} 个知识点 · ${library.edges.length} 条关系`,'success');
    if(announce)toast(`已载入 ${subject.code} 科目级知识联想库。`);
  }
  function parseCurrent(){
    const libraryApi=api(),text=$('ccRecallLibraryText');if(!libraryApi||!text)return null;
    const parsed=libraryApi.parseText(text.value);parsedPreview=parsed;
    if(!parsed.valid){report('解析失败',(parsed.errors||['内容无法解析']).join('；'),'error');return parsed}
    const warning=(parsed.warnings||[]).length?` · ${parsed.warnings.length} 条提示`:'';
    report('解析通过',`${parsed.report.nodeCount} 个知识点 · ${parsed.report.edgeCount} 条关系 · ${parsed.report.lineCount} 行${warning}`,'success');
    return parsed;
  }
  async function saveCurrent(){
    const libraryApi=api(),text=$('ccRecallLibraryText');if(!libraryApi||!text)return;
    const subject=currentSubject(),mode=$('ccRecallLibraryMode')?.value||'merge';
    const parsed=parseCurrent();if(!parsed?.valid)return;
    if(mode==='replace'&&!global.confirm(`将替换 ${subject.code} 当前科目级知识联想库。确定继续吗？`))return;
    const result=libraryApi.saveText(subject.code,text.value,{mode});
    if(!result.valid){report('保存失败',(result.errors||['未知错误']).join('；'),'error');return}
    text.value=libraryApi.toText(result.library);loadedSubjectCode=subject.code;parsedPreview=null;updateMeta(result.library,subject);
    // P4.5.31 同步服务器：深度回忆会话只读服务器快照，仅存 localStorage 到不了学员端。
    try{
      const synced=await libraryApi.writeServer(subject.code,result.library);
      report('联想库已保存',`${result.library.nodes.length} 个知识点 · ${result.library.edges.length} 条关系 · ${mode==='replace'?'替换':'合并'}模式 · 学员端同步完成（r${synced.revision}）`,'success');
      toast(`${subject.code} 科目级知识联想库已保存。`);
    }catch(error){
      const conflict=error?.status===409;
      report(conflict?'保存冲突':'已保存本浏览器',conflict?'服务器内容已被其他人更新，请重新载入后再保存。':`${result.library.nodes.length} 个知识点 · ${result.library.edges.length} 条关系 · 服务器同步失败：${escapeHTML(error?.message||'未知错误')}（学员端尚未同步）`,'error');
      toast('服务器同步失败，学员端尚未生效。');
    }
  }
  async function importFile(file){
    if(!file)return;const input=$('ccRecallLibraryFile');
    try{
      const raw=String(await file.text()).replace(/^\ufeff/,'');
      if(/\.json$/i.test(file.name)||/^\s*[\[{]/.test(raw)){
        const library=api().normalizeLibrary(JSON.parse(raw));
        $('ccRecallLibraryText').value=api().toText(library);
        parsedPreview={valid:true,library,report:{nodeCount:library.nodes.length,edgeCount:library.edges.length,lineCount:library.nodes.length},warnings:[],errors:[]};
        report('JSON 已载入',`${library.nodes.length} 个知识点 · ${library.edges.length} 条关系 · 尚未保存`,'success');
      }else{
        $('ccRecallLibraryText').value=raw;parseCurrent();
      }
      toast('文件已载入，请检查后保存。');
    }catch(error){report('导入失败',error.message||String(error),'error')}
    finally{if(input)input.value=''}
  }
  function handleSubjectChange(){
    const next=currentSubject();
    if(next.code===loadedSubjectCode)return;
    loadCurrent();
  }
  function bind(){
    $('ccRecallLibraryLoadBtn')?.addEventListener('click',()=>loadCurrent({announce:true}));
    $('ccRecallLibraryParseBtn')?.addEventListener('click',parseCurrent);
    $('ccRecallLibrarySaveBtn')?.addEventListener('click',saveCurrent);
    $('ccRecallLibraryImportBtn')?.addEventListener('click',()=>$('ccRecallLibraryFile')?.click());
    $('ccRecallLibraryFile')?.addEventListener('change',event=>importFile(event.target.files?.[0]));
    document.addEventListener('kg-content-center-subject-change',handleSubjectChange);
  }
  function init(){if(!$('ccRecallLibraryPanel'))return;bind();loadCurrent()}

  global.KGRecallAssociationAdmin=Object.freeze({loadCurrent,parseCurrent,saveCurrent,currentSubject,getPreview:()=>parsedPreview});
  document.addEventListener('DOMContentLoaded',init);
})(typeof window!=='undefined'?window:globalThis);
