'use strict';

(function(global){
  const OVERRIDE_KEY='kg_content_activity_overrides_v1';
  const SESSION_KEY='kg_local_current_user_v1';
  const clean=value=>String(value??'').trim();
  const clone=value=>JSON.parse(JSON.stringify(value));
  function currentUser(){const username=clean(global.localStorage?.getItem(SESSION_KEY));return {id:username||'local-anonymous',name:username||'未登录本地用户'}}
  function localSubmit(activities){
    const user=currentUser(),now=new Date().toISOString();let store={};try{store=JSON.parse(global.localStorage?.getItem(OVERRIDE_KEY)||'{}')}catch(error){}
    const summary={created:0,updated:0,unchanged:0,conflicts:0,rejected:0};
    (activities||[]).forEach(source=>{const activity=clone(source),existing=store[activity.id];activity.metadata=activity.metadata||{};const authorship=activity.metadata.authorship||{};activity.metadata.authorship={createdByUserId:authorship.createdByUserId||user.id,createdByName:authorship.createdByName||user.name,createdAt:authorship.createdAt||now,updatedByUserId:user.id,updatedByName:user.name,updatedAt:now};activity.metadata.ownership=activity.metadata.ownership||{ownerUserId:user.id,organizationId:''};activity.metadata.lifecycle={...(activity.metadata.lifecycle||{}),status:'submitted',revision:Number(activity.metadata.lifecycle?.revision||0)+1,sourceApplication:'question-studio-v0.2.1.2'};if(existing){if(JSON.stringify(existing)===JSON.stringify(activity))summary.unchanged+=1;else summary.updated+=1}else summary.created+=1;store[activity.id]=activity});
    global.localStorage?.setItem(OVERRIDE_KEY,JSON.stringify(store));return {success:true,provider:'local-browser',summary};
  }
  async function submit(activities,options={}){
    if(mode()==='offline-file')throw new Error('当前通过本地文件打开，浏览器无法可靠地与主程序共享活动库。请运行 serve.py 或部署到 HTTP/HTTPS 服务器后使用直连。');
    const endpoint=clean(options.endpoint||global.KG_SERVER_CONFIG?.activityImportEndpoint);
    if(endpoint){const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({activities})});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||`服务器返回 ${response.status}`);return {...payload,provider:'server'}}
    return localSubmit(activities);
  }
  function mode(){return global.KG_SERVER_CONFIG?.activityImportEndpoint?'server':(location.protocol==='file:'?'offline-file':'local-browser')}
  global.QuestionStudioSync=Object.freeze({submit,mode,currentUser});
})(window);
