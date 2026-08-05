'use strict';

/*
 * 用户帮助、需求反馈与站内消息统一仓库。
 *
 * 浏览器页面通过 KG_APP_CONFIG.engagement 连接认证后的服务端 REST 接口。
 */
(function(global){
  const FEEDBACK_KEY='kg_user_feedback_v1';
  const ANNOUNCEMENT_KEY='kg_announcements_v1';
  const READ_KEY_PREFIX='kg_user_message_reads_v1__';
  const FEEDBACK_READ_KEY_PREFIX='kg_user_feedback_reply_reads_v1__';
  const EVENT_NAME='kg-engagement-change';
  const FEEDBACK_STATUSES=Object.freeze(['pending','in_progress','resolved','closed']);
  const MESSAGE_STATUSES=Object.freeze(['draft','published','withdrawn']);

  function clone(value){if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function text(value){return String(value==null?'':value).trim()}
  function number(value,fallback=0){const result=Number(value);return Number.isFinite(result)?result:fallback}
  function uid(prefix='item'){return prefix+'-'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36))}
  function readJson(key,fallback){try{const raw=global.localStorage?.getItem(key);if(!raw)return clone(fallback);const value=JSON.parse(raw);return value==null?clone(fallback):value}catch(error){return clone(fallback)}}
  function writeJson(key,value){try{global.localStorage?.setItem(key,JSON.stringify(value));if(typeof global.CustomEvent==='function')global.dispatchEvent?.(new global.CustomEvent(EVENT_NAME,{detail:{key}}));return true}catch(error){console.warn('[KGEngagementRepository] write failed',key,error);return false}}
  function currentUser(){
    const user=global.KGAuthCore?.currentUser?.({includeInactive:true})||global.KGRolePermissions?.currentUser?.()||null;
    if(user)return {username:text(user.username||user.id),displayName:text(user.displayName||user.name||user.username),role:text(user.role||'student')||'student'};
    return {username:'guest',displayName:'游客',role:'viewer'};
  }
  function currentUserId(){return currentUser().username||'guest'}
  function config(){
    const raw=global.KG_APP_CONFIG?.engagement||global.KG_ENGAGEMENT_CONFIG||{};
    const mode=text(raw.mode||'local-demo').toLowerCase()==='remote'?'remote':'local-demo';
    return {
      mode,
      baseUrl:text(raw.baseUrl||'').replace(/\/$/,''),
      credentials:text(raw.credentials||'include')||'include',
      endpoints:{
        submitFeedback:text(raw.endpoints?.submitFeedback||'/api/feedback'),
        myFeedback:text(raw.endpoints?.myFeedback||'/api/feedback/mine'),
        adminFeedback:text(raw.endpoints?.adminFeedback||'/api/admin/feedback'),
        messages:text(raw.endpoints?.messages||'/api/messages'),
        adminMessages:text(raw.endpoints?.adminMessages||'/api/admin/messages'),
        markMessageRead:text(raw.endpoints?.markMessageRead||'/api/messages/{id}/read'),
        markAllRead:text(raw.endpoints?.markAllRead||'/api/messages/read-all'),
        markFeedbackRead:text(raw.endpoints?.markFeedbackRead||'/api/feedback/{id}/read'),
        unreadSummary:text(raw.endpoints?.unreadSummary||'/api/engagement/unread-summary')
      }
    };
  }
  function endpoint(path){const cfg=config();if(/^https?:\/\//i.test(path))return path;return cfg.baseUrl+(path.startsWith('/')?path:'/'+path)}
  function pagedEndpoint(path,options={}){
    const limit=Math.max(1,Math.min(200,Math.floor(number(options.limit,200))));
    const offset=Math.max(0,Math.floor(number(options.offset,0)));
    return path+(path.includes('?')?'&':'?')+'limit='+limit+'&offset='+offset;
  }
  async function remoteRequest(path,options={}){
    const cfg=config();
    const response=await fetch(endpoint(path),{
      method:options.method||'GET',credentials:cfg.credentials,
      headers:{'Content-Type':'application/json',...(options.headers||{})},
      body:options.body===undefined?undefined:JSON.stringify(options.body)
    });
    let payload=null;try{payload=await response.json()}catch(error){}
    if(!response.ok)throw new Error(text(payload?.detail||payload?.message||payload?.error||('服务请求失败（'+response.status+'）')));
    return payload;
  }
  async function remoteAllPages(path){
    const rows=[];let offset=0;
    while(rows.length<1000){
      const payload=await remoteRequest(pagedEndpoint(path,{limit:200,offset}));
      const page=Array.isArray(payload)?payload:(payload?.items||[]);
      rows.push(...page);
      if(Array.isArray(payload)||!payload?.pagination?.hasMore||!page.length)break;
      const next=number(payload.pagination.offset,offset)+number(payload.pagination.limit,page.length);
      if(next<=offset)break;offset=next;
    }
    return rows.slice(0,1000);
  }
  function normalizeFeedback(item,index=0){
    item=item&&typeof item==='object'?item:{};
    const actor=item.submittedBy&&typeof item.submittedBy==='object'?item.submittedBy:{};
    return {
      id:text(item.id)||('feedback-'+index),type:text(item.type||'suggestion')||'suggestion',title:text(item.title),detail:text(item.detail),
      page:text(item.page),appVersion:text(item.appVersion),contact:text(item.contact),attachment:item.attachment&&typeof item.attachment==='object'?clone(item.attachment):null,
      status:FEEDBACK_STATUSES.includes(text(item.status))?text(item.status):'pending',
      submittedBy:{username:text(actor.username||item.username||'guest')||'guest',displayName:text(actor.displayName||actor.username||'游客'),role:text(actor.role||'viewer')||'viewer'},
      createdAt:number(item.createdAt,Date.now()),updatedAt:number(item.updatedAt||item.createdAt,Date.now()),
      lastReadAt:number(item.lastReadAt||item.userLastReadAt,0),
      unreadReplyCount:Math.max(0,Math.floor(number(item.unreadReplyCount,0))),
      replies:(Array.isArray(item.replies)?item.replies:[]).map((reply,replyIndex)=>({id:text(reply?.id)||('reply-'+replyIndex),message:text(reply?.message),actor:text(reply?.actor||'管理员'),createdAt:number(reply?.createdAt,Date.now())})).filter(reply=>reply.message)
    };
  }
  function normalizeAudience(value){
    value=value&&typeof value==='object'?value:{};
    const type=['all','roles','users'].includes(text(value.type))?text(value.type):'all';
    return {type,roles:[...new Set((Array.isArray(value.roles)?value.roles:[]).map(text).filter(Boolean))],users:[...new Set((Array.isArray(value.users)?value.users:[]).map(text).filter(Boolean))]};
  }
  function normalizeAnnouncement(item,index=0){
    item=item&&typeof item==='object'?item:{};
    return {
      id:text(item.id)||('message-'+index),title:text(item.title),body:text(item.body),link:text(item.link),
      status:MESSAGE_STATUSES.includes(text(item.status))?text(item.status):'draft',audience:normalizeAudience(item.audience),
      publishAt:number(item.publishAt||item.publishedAt,0),expiresAt:number(item.expiresAt,0),publishedAt:number(item.publishedAt,0),withdrawnAt:number(item.withdrawnAt,0),
      createdBy:text(item.createdBy||'system-admin'),createdAt:number(item.createdAt,Date.now()),updatedAt:number(item.updatedAt||item.createdAt,Date.now())
    };
  }
  function localFeedback(){const rows=readJson(FEEDBACK_KEY,[]);return (Array.isArray(rows)?rows:[]).map(normalizeFeedback)}
  function saveLocalFeedback(rows){return writeJson(FEEDBACK_KEY,rows.map(normalizeFeedback))}
  function localAnnouncements(){const rows=readJson(ANNOUNCEMENT_KEY,[]);return (Array.isArray(rows)?rows:[]).map(normalizeAnnouncement)}
  function saveLocalAnnouncements(rows){return writeJson(ANNOUNCEMENT_KEY,rows.map(normalizeAnnouncement))}
  function readKey(userId=currentUserId()){return READ_KEY_PREFIX+encodeURIComponent(text(userId)||'guest')}
  function localReads(userId=currentUserId()){const value=readJson(readKey(userId),{});return value&&typeof value==='object'?value:{}}
  function saveLocalReads(value,userId=currentUserId()){return writeJson(readKey(userId),value||{})}
  function feedbackReadKey(userId=currentUserId()){return FEEDBACK_READ_KEY_PREFIX+encodeURIComponent(text(userId)||'guest')}
  function localFeedbackReads(userId=currentUserId()){const value=readJson(feedbackReadKey(userId),{});return value&&typeof value==='object'?value:{}}
  function saveLocalFeedbackReads(value,userId=currentUserId()){return writeJson(feedbackReadKey(userId),value||{})}
  function withFeedbackReadState(item,reads={}){
    const row=normalizeFeedback(item),lastReadAt=number(reads[row.id],row.lastReadAt||0);
    const unreadReplyCount=row.replies.reduce((count,reply)=>count+(number(reply.createdAt,0)>lastReadAt?1:0),0);
    return {...row,lastReadAt,unreadReplyCount};
  }
  function audienceAllows(message,user=currentUser()){
    const audience=normalizeAudience(message?.audience);
    if(audience.type==='all')return true;
    if(audience.type==='roles')return audience.roles.includes(text(user.role));
    if(audience.type==='users')return audience.users.includes(text(user.username));
    return false;
  }
  function isVisibleMessage(message,{now=Date.now(),user=currentUser(),includeInactive=false}={}){
    const row=normalizeAnnouncement(message);
    if(!includeInactive){
      if(row.status!=='published')return false;
      const start=row.publishAt||row.publishedAt||0;if(start&&start>now)return false;
      if(row.expiresAt&&row.expiresAt<=now)return false;
    }
    return audienceAllows(row,user);
  }

  async function submitFeedback(payload={}){
    const actor=currentUser();
    const next=normalizeFeedback({...payload,id:uid('feedback'),status:'pending',submittedBy:actor,createdAt:Date.now(),updatedAt:Date.now(),replies:[]});
    if(!next.title||!next.detail)throw new Error('请填写反馈标题和详细描述。');
    if(config().mode==='remote')return normalizeFeedback(await remoteRequest(config().endpoints.submitFeedback,{method:'POST',body:next}));
    const rows=localFeedback();rows.unshift(next);if(!saveLocalFeedback(rows.slice(0,1000)))throw new Error('反馈保存失败。');return clone(next);
  }
  async function listMyFeedback(options={}){
    if(config().mode==='remote'){
      return (await remoteAllPages(config().endpoints.myFeedback)).map(normalizeFeedback);
    }
    const userId=currentUserId(),reads=localFeedbackReads(userId);
    return localFeedback().filter(item=>item.submittedBy.username===userId).sort((a,b)=>b.createdAt-a.createdAt).map(item=>clone(withFeedbackReadState(item,reads)));
  }
  async function unreadFeedbackReplyCount(){return (await listMyFeedback()).reduce((count,item)=>count+Math.max(0,number(item.unreadReplyCount,0)),0)}
  async function markFeedbackRead(id){
    id=text(id);if(!id)return false;
    if(config().mode==='remote'){
      const path=config().endpoints.markFeedbackRead.replace('{id}',encodeURIComponent(id));
      await remoteRequest(path,{method:'POST'});return true;
    }
    const userId=currentUserId(),feedback=localFeedback().find(item=>item.id===id&&item.submittedBy.username===userId);if(!feedback)return false;
    const reads=localFeedbackReads(userId),latestReplyAt=feedback.replies.reduce((latest,reply)=>Math.max(latest,number(reply.createdAt,0)),0);
    reads[id]=Math.max(Date.now(),latestReplyAt);saveLocalFeedbackReads(reads,userId);return true;
  }
  async function listFeedback(options={}){
    let rows;
    if(config().mode==='remote')rows=(await remoteAllPages(config().endpoints.adminFeedback)).map(normalizeFeedback)
    else rows=localFeedback();
    const status=text(options.status),query=text(options.query).toLowerCase(),type=text(options.type);
    if(status&&status!=='ALL')rows=rows.filter(item=>item.status===status);if(type&&type!=='ALL')rows=rows.filter(item=>item.type===type);
    if(query)rows=rows.filter(item=>[item.title,item.detail,item.page,item.contact,item.submittedBy.username,item.submittedBy.displayName].some(value=>text(value).toLowerCase().includes(query)));
    return rows.sort((a,b)=>b.updatedAt-a.updatedAt).map(clone);
  }
  async function updateFeedback(id,patch={}){
    id=text(id);if(!id)throw new Error('反馈 ID 不能为空。');
    if(config().mode==='remote')return normalizeFeedback(await remoteRequest(config().endpoints.adminFeedback+'/'+encodeURIComponent(id),{method:'PATCH',body:patch}));
    const rows=localFeedback(),index=rows.findIndex(item=>item.id===id);if(index<0)throw new Error('反馈不存在或已删除。');
    const status=text(patch.status||rows[index].status);if(status&&!FEEDBACK_STATUSES.includes(status))throw new Error('反馈状态无效。');
    rows[index]=normalizeFeedback({...rows[index],...patch,status,updatedAt:Date.now()});saveLocalFeedback(rows);return clone(rows[index]);
  }
  async function replyFeedback(id,message){
    id=text(id);message=text(message);if(!message)throw new Error('回复内容不能为空。');
    if(config().mode==='remote')return normalizeFeedback(await remoteRequest(config().endpoints.adminFeedback+'/'+encodeURIComponent(id)+'/replies',{method:'POST',body:{message}}));
    const rows=localFeedback(),index=rows.findIndex(item=>item.id===id);if(index<0)throw new Error('反馈不存在或已删除。');
    const actor=currentUser();rows[index].replies.push({id:uid('reply'),message,actor:actor.displayName||actor.username,createdAt:Date.now()});rows[index].updatedAt=Date.now();
    if(rows[index].status==='pending')rows[index].status='in_progress';saveLocalFeedback(rows);return clone(rows[index]);
  }

  async function listAnnouncements(options={}){
    let rows;
    if(config().mode==='remote')rows=(await remoteAllPages(config().endpoints.adminMessages)).map(normalizeAnnouncement)
    else rows=localAnnouncements();
    const status=text(options.status),query=text(options.query).toLowerCase();
    if(status&&status!=='ALL')rows=rows.filter(item=>item.status===status);
    if(query)rows=rows.filter(item=>[item.title,item.body,item.link,item.createdBy].some(value=>text(value).toLowerCase().includes(query)));
    return rows.sort((a,b)=>b.updatedAt-a.updatedAt).map(clone);
  }
  async function saveAnnouncement(payload={}){
    const now=Date.now(),id=text(payload.id),actor=currentUser();
    if(config().mode==='remote'){
      const path=id?config().endpoints.adminMessages+'/'+encodeURIComponent(id):config().endpoints.adminMessages;
      return normalizeAnnouncement(await remoteRequest(path,{method:id?'PATCH':'POST',body:payload}));
    }
    const rows=localAnnouncements();let index=id?rows.findIndex(item=>item.id===id):-1;
    const base=index>=0?rows[index]:{id:uid('message'),status:'draft',createdAt:now,createdBy:actor.username};
    const next=normalizeAnnouncement({...base,...payload,id:base.id,updatedAt:now});
    if(!next.title||!next.body)throw new Error('请填写消息标题和正文。');
    if(index>=0)rows[index]=next;else rows.unshift(next);saveLocalAnnouncements(rows);return clone(next);
  }
  async function publishAnnouncement(id,{publishAt=Date.now()}={}){
    id=text(id);if(config().mode==='remote')return normalizeAnnouncement(await remoteRequest(config().endpoints.adminMessages+'/'+encodeURIComponent(id)+'/publish',{method:'POST',body:{publishAt}}));
    const rows=localAnnouncements(),index=rows.findIndex(item=>item.id===id);if(index<0)throw new Error('消息不存在。');
    rows[index]=normalizeAnnouncement({...rows[index],status:'published',publishAt:number(publishAt,Date.now()),publishedAt:Date.now(),withdrawnAt:0,updatedAt:Date.now()});saveLocalAnnouncements(rows);return clone(rows[index]);
  }
  async function withdrawAnnouncement(id){
    id=text(id);if(config().mode==='remote')return normalizeAnnouncement(await remoteRequest(config().endpoints.adminMessages+'/'+encodeURIComponent(id)+'/withdraw',{method:'POST'}));
    const rows=localAnnouncements(),index=rows.findIndex(item=>item.id===id);if(index<0)throw new Error('消息不存在。');
    rows[index]=normalizeAnnouncement({...rows[index],status:'withdrawn',withdrawnAt:Date.now(),updatedAt:Date.now()});saveLocalAnnouncements(rows);return clone(rows[index]);
  }
  async function deleteAnnouncement(id){
    id=text(id);if(config().mode==='remote'){await remoteRequest(config().endpoints.adminMessages+'/'+encodeURIComponent(id),{method:'DELETE'});return true}
    const rows=localAnnouncements(),target=rows.find(item=>item.id===id);if(!target)return false;if(target.status==='published')throw new Error('已发布消息请先撤回，不能直接删除。');
    saveLocalAnnouncements(rows.filter(item=>item.id!==id));return true;
  }
  async function listUserMessages(options={}){
    if(config().mode==='remote')return (await remoteAllPages(config().endpoints.messages)).map(item=>({...normalizeAnnouncement(item),read:!!item.read,readAt:number(item.readAt,0)}))
    const user=currentUser(),reads=localReads(user.username);
    return localAnnouncements().filter(item=>isVisibleMessage(item,{user})).sort((a,b)=>(b.publishAt||b.publishedAt||b.createdAt)-(a.publishAt||a.publishedAt||a.createdAt)).map(item=>({...clone(item),read:!!reads[item.id],readAt:number(reads[item.id],0)}));
  }
  async function unreadCount(){return (await listUserMessages()).filter(item=>!item.read).length}
  async function unreadSummary(){
    if(config().mode==='remote'){
      const summary=await remoteRequest(config().endpoints.unreadSummary);
      const messages=Math.max(0,number(summary?.messages,0)),feedbackReplies=Math.max(0,number(summary?.feedbackReplies,0));
      return {messages,feedbackReplies,total:messages+feedbackReplies};
    }
    const [messages,feedbackReplies]=await Promise.all([unreadCount(),unreadFeedbackReplyCount()]);
    return {messages,feedbackReplies,total:messages+feedbackReplies};
  }
  async function markMessageRead(id){
    id=text(id);if(!id)return false;
    if(config().mode==='remote'){const path=config().endpoints.markMessageRead.replace('{id}',encodeURIComponent(id));await remoteRequest(path,{method:'POST'});return true}
    const userId=currentUserId(),reads=localReads(userId);reads[id]=Date.now();saveLocalReads(reads,userId);return true;
  }
  async function markAllMessagesRead(){
    if(config().mode==='remote'){await remoteRequest(config().endpoints.markAllRead,{method:'POST'});return true}
    const userId=currentUserId(),reads=localReads(userId),messages=await listUserMessages();messages.forEach(item=>{reads[item.id]=Date.now()});saveLocalReads(reads,userId);return true;
  }
  function messageStats(id){
    id=text(id);const keys=[];try{for(let i=0;i<(global.localStorage?.length||0);i++){const key=global.localStorage.key(i);if(key?.startsWith(READ_KEY_PREFIX))keys.push(key)}}catch(error){}
    let readCount=0;keys.forEach(key=>{const map=readJson(key,{});if(map&&map[id])readCount+=1});return {readCount};
  }

  const api=Object.freeze({
    feedbackStorageKey:FEEDBACK_KEY,feedbackReadStoragePrefix:FEEDBACK_READ_KEY_PREFIX,announcementStorageKey:ANNOUNCEMENT_KEY,readStoragePrefix:READ_KEY_PREFIX,eventName:EVENT_NAME,
    feedbackStatuses:FEEDBACK_STATUSES,messageStatuses:MESSAGE_STATUSES,config,currentUser,currentUserId,
    submitFeedback,listMyFeedback,listFeedback,updateFeedback,replyFeedback,unreadFeedbackReplyCount,markFeedbackRead,
    listAnnouncements,saveAnnouncement,publishAnnouncement,withdrawAnnouncement,deleteAnnouncement,
    listUserMessages,unreadCount,unreadSummary,markMessageRead,markAllMessagesRead,messageStats,isVisibleMessage,audienceAllows
  });
  global.KGEngagementRepository=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
