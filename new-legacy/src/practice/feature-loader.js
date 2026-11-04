/* Practice entry: optional UI and answer modules are fetched only when requested. */
(function(global){
  'use strict';
  if(global.KGPracticeFeatures)return;
  const manifest=document.getElementById('kg-page-features');
  const groups=manifest?JSON.parse(manifest.textContent):{};
  const dependencies={account:['auth'],community:['question'],answer:['community']};
  if(!manifest){
    document.querySelectorAll('[data-practice-feature]').forEach(node=>{
      const name=node.dataset.practiceFeature,group=groups[name]||(groups[name]={depends:dependencies[name]||[],scripts:[],styles:[]});
      if(node.tagName==='SCRIPT')group.scripts.push(node.src);else if(node.tagName==='LINK')group.styles.push(node.href);
    });
  }
  const loader=global.KGFeatureAssets.create({groups});
  const busy=new WeakSet();
  function showFailure(error,retry){
    let status=document.getElementById('practiceFeatureStatus');
    if(!status){status=document.createElement('div');status.id='practiceFeatureStatus';status.className='practice-feature-status';status.setAttribute('role','alert');document.body.append(status)}
    status.replaceChildren(document.createTextNode('功能加载失败，请检查网络后重试。'));
    const button=document.createElement('button');button.type='button';button.textContent='重试';button.onclick=()=>{status.hidden=true;retry()};status.append(button);status.hidden=false;
  }
  async function load(name){
    await loader.load(name);
    if(name==='account'&&global.KGSystemDomain){
      const api=global.KGSystemDomain;
      if(api.initializationState?.().status==='failed')await api.retryInitialization();else await api.ready;
    }
  }
  function isReady(name){return loader.state(name)==='ready'&&(name!=='account'||global.KGSystemDomain?.initializationState?.().status==='ready')}
  function run(name,action){
    return load(name).then(action).catch(error=>{showFailure(error,()=>run(name,action));return false});
  }
  function intercept(event,name,selector){
    const target=event.target.closest?.(selector);if(!target||isReady(name))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(busy.has(target))return;busy.add(target);target.setAttribute('aria-busy','true');
    run(name,()=>target.click()).finally(()=>{busy.delete(target);target.removeAttribute('aria-busy')});
  }
  document.addEventListener('click',event=>{
    intercept(event,'account','#accountMenuUserCenterBtn,#accountMenuUpgradeBtn,#upgradeMemberBtn,[data-open-subscription-detail]');
  },true);
  function currentUser(){return global.KGAuthCore?.currentUser?.()||null}
  const authProxy={open:(...args)=>run('auth',()=>global.KGSharedAuthDialog.open(...args)),close:()=>{},isLoggedIn:()=>!!currentUser()};
  global.KGSharedAuthDialog=global.KGSharedAuthDialog||authProxy;
  global.authOpen=global.authOpen||authProxy.open;
  global.KGAuthRuntime={...(global.KGAuthRuntime||{}),openAuth:authProxy.open,isLoggedIn:()=>!!currentUser(),logout:async()=>{
    const result=await global.KGAuthCore.logout({source:'做题大厅'});global.KGRolePermissions?.renderStatus?.(document.getElementById('authStatus'));return result;
  }};
  global.KGUserCenter=global.KGUserCenter||{
    open:(...args)=>run('account',()=>global.KGUserCenter.open(...args)),
    openSubscriptionDetail:(...args)=>run('account',()=>global.KGUserCenter.openSubscriptionDetail(...args))
  };
  global.KGPracticeFeatures=Object.freeze({load,run,state:name=>isReady(name)?'ready':loader.state(name)==='ready'?'error':loader.state(name)});
  // Callback URLs need account-flow processing even before a user clicks login.
  if(/[?&](?:wechat|wx_|code=|state=)/.test(global.location?.search||''))void run('auth',()=>{});
})(window);
