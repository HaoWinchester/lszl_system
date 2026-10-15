'use strict';
(function(global){
  const text=value=>String(value??'');
  const escape=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function historyRows(records=[]){
    return records.slice().sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)).slice(0,5).map(record=>{
      const answered=Math.max(0,Number(record.answered)||0),correct=Math.min(answered,Math.max(0,Number(record.correct)||0));
      return {id:text(record.sessionId),name:text(record.paperName||'未命名练习'),time:record.createdAt,
        total:Math.max(0,Number(record.total)||0),accuracy:answered?Math.round(correct/answered*100)+'%':'—',
        duration:record.durationMs>0?Math.ceil(record.durationMs/60000)+' 分钟':'—',
        action:record.sessionId&&['active','paused'].includes(record.status)?'resume':record.sessionId&&record.reportAvailable===true?'report':'none'};
    });
  }
  function createLoader({getUser,load,onRows,onState}){
    let token=0;
    function invalidate(){token++;onRows([])}
    async function refresh(){
      const owner=getUser(),request=++token;onRows([]);
      if(!owner){onState('guest');return false}
      onState('loading');
      try{const rows=await load();if(token!==request||owner!==getUser())return false;onRows(rows);onState(rows.length?'ready':'empty');return true}
      catch(error){if(token!==request||owner!==getUser())return false;onRows([]);onState('error');return false}
    }
    return Object.freeze({refresh,invalidate});
  }
  function create(options){
    const root=options.root;if(!root)return null;
    const body=root.querySelector('#practiceRecentBody'),status=root.querySelector('#practiceRecentStatus'),retry=root.querySelector('[data-recent-retry]');
    const tabs=[...root.querySelectorAll('[data-recent-tab]')];let active='history';
    const date=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})};
    function render(rows){
      if(!body)return;
      body.innerHTML=active==='history'?historyRows(rows).map(row=>`<tr><td>${escape(date(row.time))}</td><td>${escape(row.name)}</td><td>${row.total||'—'}</td><td>${row.accuracy}</td><td>${row.duration}</td><td>${row.action==='none'?'<span>已结束</span>':`<button type="button" data-recent-${row.action}="${escape(row.id)}">${row.action==='resume'?'继续练习':'查看成绩'}</button>`}</td></tr>`).join(''):
        rows.slice(0,5).map(row=>`<tr><td>${escape(date(row.favoritedAt))}</td><td colspan="4">${escape(row.stemText||'收藏题目')}</td><td><button type="button" data-recent-favorite="${escape(row.questionId)}">查看题目</button></td></tr>`).join('');
    }
    function state(value){
      if(status){status.hidden=value==='ready';status.textContent=({loading:'正在读取…',empty:active==='history'?'完成或保存一次练习后，记录会显示在这里。':'还没有收藏题目。',guest:'登录后查看你的学习记录和收藏。',error:'暂时无法读取，请重试。'})[value]||''}
      if(retry)retry.hidden=value!=='error';
      const table=root.querySelector('.practice-recent-table');if(table)table.hidden=value!=='ready';
    }
    const loader=createLoader({getUser:options.getUser,load:async()=>active==='history'?(await options.getHistory()||[]):((await options.getFavorites())?.favorites||[]),onRows:render,onState:state});
    function select(tab){
      active=tab;loader.invalidate();
      tabs.forEach(button=>{const selected=button.dataset.recentTab===active;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1});
      const panel=root.querySelector('#practiceRecentPanel');panel?.setAttribute('aria-labelledby',active==='history'?'practiceRecentHistoryTab':'practiceRecentFavoritesTab');
      return loader.refresh();
    }
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!root.contains(button))return;
      if(button.dataset.recentTab){void select(button.dataset.recentTab);return}
      if(button.hasAttribute('data-recent-retry')){void loader.refresh();return}
      if(button.hasAttribute('data-recent-report')){options.onReport(button.dataset.recentReport);return}
      if(button.hasAttribute('data-recent-resume')){options.onResume(button.dataset.recentResume);return}
      if(button.hasAttribute('data-recent-favorite')){options.onFavorite(button.dataset.recentFavorite);return}
      const action=button.dataset.lobbyOpen;if(action==='history'||action==='reports')options.onHistory();else if(action==='favorites')options.onFavorites();else if(action==='account')options.onSettings();else if(action==='recent')active==='history'?options.onHistory():options.onFavorites();
    });
    root.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-recent-tab]');if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();void select(tabs[i].dataset.recentTab);
      }
      if(event.key==='Escape')root.querySelectorAll('.practice-lobby-help[open]').forEach(detail=>{detail.open=false;detail.querySelector('summary')?.focus()});
    });
    root.addEventListener('click',event=>root.querySelectorAll('.practice-lobby-help[open]').forEach(detail=>{if(!detail.contains(event.target))detail.open=false}));
    global.addEventListener?.('kg-auth-session-change',()=>{loader.invalidate();void loader.refresh()});
    global.document?.addEventListener('kg:question-favorites-changed',()=>{if(active==='favorites')void loader.refresh()});
    return Object.freeze({refresh:loader.refresh,refreshFavorites:()=>active==='favorites'?loader.refresh():Promise.resolve(),updateHistory:()=>active==='history'?loader.refresh():Promise.resolve()});
  }
  const api=Object.freeze({historyRows,createLoader,create});global.KGPracticeLobbyDashboard=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
