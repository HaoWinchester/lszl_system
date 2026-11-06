'use strict';

/* One demand-loaded explanation player, shared by every knowledge-sky entry. */
(function(global){
  function create({host,getUser}){
    const document=host.ownerDocument;
    host.innerHTML='<h4>音频讲解</h4><p class="kg-knowledge-audio-status" data-knowledge-audio-status role="status" aria-live="polite"></p><ol class="kg-knowledge-audio-list" data-knowledge-audio-list></ol><button type="button" class="btn" data-knowledge-audio-more hidden>更多讲解</button><button type="button" class="btn" data-knowledge-audio-retry hidden>重试读取</button><p class="kg-knowledge-audio-current" data-knowledge-audio-current hidden></p><audio controls preload="none" aria-label="讲解音频播放器" hidden></audio><button type="button" class="btn" data-knowledge-audio-play-retry hidden>重试播放</button>';
    const find=selector=>host.querySelector(selector),list=find('[data-knowledge-audio-list]'),status=find('[data-knowledge-audio-status]');
    const more=find('[data-knowledge-audio-more]'),retry=find('[data-knowledge-audio-retry]'),playRetry=find('[data-knowledge-audio-play-retry]');
    const audio=find('audio'),currentTitle=find('[data-knowledge-audio-current]');
    let generation=0,scope=null,controller=null,pending=null,offset=0,total=0,items=[],retryOffset=0,current=null,playSerial=0;
    const owner=()=>{try{return String(getUser()||'')}catch(_){return ''}};
    const active=stamp=>!!scope&&stamp===generation&&scope.owner===owner();
    function stop(){
      playSerial++;current=null;audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;
      currentTitle.hidden=true;currentTitle.textContent='';playRetry.hidden=true;
    }
    function close(){
      generation++;controller?.abort();controller=null;pending=null;scope=null;stop();
      offset=total=0;items=[];list.replaceChildren();status.textContent='';more.hidden=true;retry.hidden=true;
      host.hidden=true;host.setAttribute('aria-busy','false');
    }
    function normalize(item){
      if(!item||typeof item.id!=='string'||!item.id||typeof item.title!=='string'||!item.title.trim()||typeof item.contentUrl!=='string'||typeof item.mimeType!=='string')throw Error('Invalid audio resource');
      const url=new URL(item.contentUrl,global.location.href);
      if(url.origin!==global.location.origin||url.pathname!=='/api/v1/learning/knowledge-audios/'+encodeURIComponent(item.id)+'/content'||url.search||url.hash)throw Error('Invalid audio content URL');
      return {...item,contentUrl:url.pathname};
    }
    function meta(item){
      const parts=[],seconds=Math.ceil(Number(item.durationMs)/1000),bytes=Number(item.byteLength);
      if(Number.isFinite(seconds)&&seconds>0)parts.push(Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'));
      if(Number.isFinite(bytes)&&bytes>0)parts.push(bytes<1048576?Math.ceil(bytes/1024)+' KB':(bytes/1048576).toFixed(1)+' MB');
      return parts.join(' · ');
    }
    function renderItems(){
      list.replaceChildren();
      for(const item of items){
        const row=document.createElement('li'),button=document.createElement('button'),details=document.createElement('small');
        button.type='button';button.className='btn';button.dataset.knowledgeAudioPlay=item.id;button.textContent='播放讲解：'+item.title;
        button.setAttribute('aria-current',String(current?.id===item.id));details.textContent=meta(item);row.append(button,details);list.append(row);
      }
      more.hidden=offset>=total;
    }
    async function load(pageOffset){
      if(pending)return pending;
      const stamp=generation;if(!active(stamp))return false;
      controller=new AbortController();const signal=controller.signal;retryOffset=pageOffset;
      host.setAttribute('aria-busy','true');status.textContent='正在读取音频讲解…';retry.hidden=true;more.disabled=true;
      const request=global.KGDomainApi.request({path:'/api/v1/learning/knowledge-nodes/'+encodeURIComponent(scope.taxonomyId)+'/'+encodeURIComponent(scope.nodeId)+'/audios?offset='+pageOffset+'&limit=20',signal});
      pending=(async()=>{
        try{
          const data=await request;
          if(!active(stamp))return false;
          if(!Array.isArray(data?.items)||!Number.isInteger(data.total)||data.total<0||data.offset!==pageOffset||data.items.length>20)throw Error('Invalid audio list');
          const next=data.items.map(normalize),ids=new Set(items.map(item=>item.id));
          if(next.some(item=>{if(ids.has(item.id))return true;ids.add(item.id);return false})||data.total<pageOffset+next.length||(!next.length&&data.total>pageOffset))throw Error('Invalid audio page');
          items.push(...next);offset=pageOffset+next.length;total=data.total;renderItems();
          status.textContent=items.length?'点击“播放讲解”开始学习。':'暂无音频讲解。';return true;
        }catch(error){
          if(!active(stamp)||signal.aborted)return false;
          if(error?.status===401){stop();items=[];list.replaceChildren();more.hidden=true;retryOffset=0}
          status.textContent=error?.status===401?'登录已失效，请重新登录后重试。':'音频讲解暂时无法读取，请重试。';retry.hidden=false;return false;
        }finally{
          if(active(stamp)){pending=null;controller=null;host.setAttribute('aria-busy','false');more.disabled=false}
        }
      })();
      return pending;
    }
    function open(node){
      const username=owner(),key=JSON.stringify([username,node?.taxonomyId,node?.primaryNodeId]);
      if(scope?.key===key)return pending||Promise.resolve(true);
      close();
      if(!username||!node||Number(node.audioCount)<=0||node.taxonomyId==null||node.primaryNodeId==null)return Promise.resolve(false);
      scope={key,owner:username,taxonomyId:String(node.taxonomyId),nodeId:String(node.primaryNodeId)};host.hidden=false;
      return load(0);
    }
    async function play(item,force=false){
      const stamp=generation;if(!active(stamp))return;
      if(!audio.canPlayType(item.mimeType)){stop();status.textContent='当前浏览器暂不支持此音频格式，请更换浏览器后重试。';return}
      if(current?.id!==item.id||force||audio.error){stop();current=item;audio.src=item.contentUrl;audio.load()}
      const serial=++playSerial;audio.hidden=false;currentTitle.hidden=false;currentTitle.textContent=item.title;playRetry.hidden=true;
      for(const button of list.querySelectorAll('[data-knowledge-audio-play]'))button.setAttribute('aria-current',String(button.dataset.knowledgeAudioPlay===item.id));
      status.textContent='正在打开音频…';
      try{
        await audio.play();
        if(active(stamp)&&serial===playSerial){status.textContent='可使用播放器暂停、拖动进度或调整播放速度。';playRetry.hidden=true}
      }catch(error){
        if(active(stamp)&&serial===playSerial){status.textContent='音频暂时无法播放，请重试。';playRetry.hidden=false}
      }
    }
    host.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-knowledge-audio-play')){const item=items.find(item=>item.id===button.dataset.knowledgeAudioPlay);if(item)void play(item)}
      else if(button===more)void load(offset);
      else if(button===retry)void load(retryOffset);
      else if(button===playRetry&&current)void play(current,true);
    });
    audio.addEventListener('play',()=>{if(!active(generation))stop()});
    audio.addEventListener('error',()=>{if(active(generation)&&current&&audio.error){status.textContent='音频暂时无法播放，请重试。';playRetry.hidden=false}});
    close();
    return Object.freeze({open,close});
  }
  global.KGKnowledgeAudio=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
