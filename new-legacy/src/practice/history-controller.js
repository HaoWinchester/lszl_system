'use strict';
(function(global){
  const text=value=>String(value??'');
  const escape=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The cursor and summaries live only for the current drawer visit. Every reset
  // invalidates in-flight work as well as the records belonging to that visit.
  function createLoader({getUser,loadPage,onChange}){
    let generation=0,state,clearing=null;
    const publish=next=>{state={...state,...next};onChange(state)};
    function reset(){generation++;publish({records:[],total:0,nextCursor:null,loaded:false,loading:false,status:getUser()?'idle':'guest'})}
    function current(token,owner){return token===generation&&owner===getUser()}
    async function loadMore(){
      if(!getUser()){reset();return false}
      if(state.loading||(state.loaded&&!state.nextCursor))return false;
      const token=generation,owner=getUser(),cursor=state.nextCursor;
      publish({loading:true,status:'loading'});
      try{
        const page=await loadPage({limit:20,cursor});
        if(!current(token,owner))return false;
        const records=state.records.slice(),seen=new Set(records.map(identity));
        for(const record of Array.isArray(page?.sessions)?page.sessions:[]){const id=identity(record);if(!seen.has(id)){seen.add(id);records.push(record)}}
        publish({records,total:Math.max(records.length,Number(page?.total)||0),nextCursor:page?.nextCursor||null,loaded:true,loading:false,status:'ready'});
        return true;
      }catch(error){if(current(token,owner))publish({loading:false,status:'error'});return false}
    }
    function refresh(){
      const owner=getUser();
      // A reopen must read after this owner's DELETE commits, while another
      // account remains free to load its own records immediately.
      if(clearing?.owner===owner)return clearing.promise.then(()=>getUser()===owner?refresh():false);
      reset();return owner?loadMore():Promise.resolve(false);
    }
    function clear(remove){
      const owner=getUser();if(!owner)return Promise.resolve(false);
      if(clearing?.owner===owner)return clearing.promise;
      const token=++generation,previousStatus=state.status,operation={owner,promise:null};
      clearing=operation;publish({loading:true,status:'loading'});
      operation.promise=(async()=>{
        try{await remove();if(!current(token,owner))return false;publish({records:[],total:0,nextCursor:null,loaded:true,loading:false,status:'ready'});return true}
        catch(error){if(current(token,owner))publish({loading:false,status:previousStatus==='loading'?'ready':previousStatus});return false}
        finally{if(clearing===operation)clearing=null}
      })();
      return operation.promise;
    }
    reset();
    return Object.freeze({refresh,loadMore,reset,clear});
  }
  function identity(record){return text(record?.sessionId||record?.eventId||record?.id)||JSON.stringify([record?.paperId,record?.paperName,record?.mode,record?.createdAt,record?.status])}
  function groupRecords(records){
    const groups=new Map();
    records.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).forEach(record=>{
      const key=text(record?.paperId)||('__'+text(record?.paperName||'未命名练习'));
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record);
    });
    return groups;
  }
  function create({root,getApi,getUser,onPractice,onReport,onResume,modeLabel}){
    if(!root)return null;
    const find=id=>root.querySelector('#'+id),list=find('practiceHistoryList'),empty=find('practiceHistoryEmpty'),summary=find('practiceHistorySummary'),more=find('practiceHistoryLoadMore'),status=find('practiceHistoryPageStatus'),clear=find('practiceClearHistoryBtn'),count=global.document?.getElementById('practiceHistoryCount'),body=list?.closest('.practice-drawer-body');
    const statusLabel=record=>({active:'进行中',paused:'已保存',completed:'已完成',abandoned:'已结束'})[record.status]||'状态未知';
    function time(value){const date=new Date(value);return Number.isNaN(date.getTime())?'刚刚':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}
    function attempt(record){
      const id=escape(record.sessionId),answered=Math.max(0,Number(record.answered)||0),total=Math.max(0,Number(record.total)||0),rate=answered?Math.round(Math.max(0,Number(record.correct)||0)/answered*100)+'%':'—';
      return `<li class="practice-history-attempt"><div><strong>${escape(modeLabel(record.mode))} · ${statusLabel(record)}</strong><p>${escape(time(record.createdAt))} · 已答 ${answered}${total?' / '+total:''} 题 · 已答题正确率 ${rate}</p></div><div class="practice-history-actions">${record.sessionId&&['active','paused'].includes(record.status)?`<button type="button" data-history-resume="${id}">继续本次</button>`:''}${record.sessionId&&record.reportAvailable===true?`<button type="button" data-history-session="${id}">查看本次成绩</button>`:''}</div></li>`;
    }
    let rendered=null;
    function render(state){
      const groups=groupRecords(state.records),guest=state.status==='guest';
      if(list&&rendered!==state.records){
        const expanded=new Set([...list.querySelectorAll('details[open]')].map(detail=>detail.closest('[data-history-key]')?.dataset.historyKey)),scrollTop=body?.scrollTop||0;
        list.innerHTML=[...groups.entries()].map(([key,attempts])=>{
          const latest=attempts[0],paperId=key.replace('__','');
          return `<article class="practice-history-group" data-history-key="${escape(key)}" data-history-paper="${escape(paperId)}"><header><strong>${escape(latest.paperName||'未命名练习')}</strong><button type="button" class="practice-secondary-btn" data-history-practice="${escape(paperId)}">进入练习</button></header><details${expanded.has(key)?' open':''}><summary>查看 ${attempts.length} 次记录 · 最近${statusLabel(latest)}</summary><ol>${attempts.map(attempt).join('')}</ol></details></article>`;
        }).join('');
        if(body)body.scrollTop=scrollTop;rendered=state.records;
      }
      if(empty){empty.hidden=state.records.length>0;empty.textContent=guest?'登录后可查看你的学习记录':state.status==='error'?'学习记录暂时无法读取，请稍后重试。':state.loading?'正在读取学习记录…':'暂无练习记录'}
      if(summary)summary.textContent=guest?'登录后可查看你的学习记录':`已加载 ${state.records.length} / 共 ${state.total} 条记录 · ${groups.size} 份试卷`;
      if(clear)clear.disabled=guest||!state.records.length||state.loading;
      if(count){count.textContent=String(groups.size);count.hidden=!state.records.length}
      if(more){more.hidden=guest||(!state.loading&&state.status!=='error'&&!state.nextCursor);more.disabled=state.loading;more.textContent=state.loading?'正在加载…':state.status==='error'?'重试':'加载更多'}
      if(status){status.hidden=guest||state.status==='idle';status.textContent=state.loading?'正在读取学习记录…':state.status==='error'?(state.records.length?'加载失败，已保留当前记录，请重试。':'学习记录暂时无法读取，请重试。'):state.loaded&&!state.nextCursor?'已显示全部记录':''}
    }
    const loader=createLoader({getUser,onChange:render,loadPage:async options=>{
      const api=getApi();
      if(api?.listSessionsPage)return api.listSessionsPage(options);
      // Compatibility for older embedders; production always uses the page API.
      const sessions=await api.listSessions(options);return {sessions,total:sessions.length,nextCursor:null};
    }});
    more?.addEventListener('click',()=>void loader.loadMore());
    list?.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!list.contains(button))return;
      if(button.hasAttribute('data-history-practice'))onPractice(button.dataset.historyPractice);
      else if(button.hasAttribute('data-history-session'))onReport(button.dataset.historySession);
      else if(button.hasAttribute('data-history-resume'))onResume(button.dataset.historyResume);
    });
    return loader;
  }
  global.KGPracticeHistory=Object.freeze({createLoader,create});
})(typeof window!=='undefined'?window:globalThis);
