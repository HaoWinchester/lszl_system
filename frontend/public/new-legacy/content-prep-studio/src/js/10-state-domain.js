const state={
  knowledgeTree:null,
  recallLibrary:{schemaVersion:1,nodes:[],edges:[],updatedAt:''},
  questionBank:{id:generateSystemId('bank'),name:'PMP 内容准备题库',subject:'PMP',description:'',version:'1.0',visibility:'private',createdAt:Date.now(),updatedAt:Date.now(),questions:[]},
  principles:{schemaVersion:1,items:[],updatedAt:Date.now()},
  synthesisPresets:{schemaVersion:1,items:[],updatedAt:Date.now()},
  tagConfig:{schemaVersion:2,slotIdStrategy:'semantic-v1',names:{},groupNames:{},categoryNames:{},aliases:{},slotAliases:{},looseAliases:{}},
  currentQuestionId:'',
  currentRecallId:'',
  currentPrincipleId:'',
  demoQuestionId:'',
  demoLang:'zh',
  recallPreviewCandidateId:'',
  lastSelection:null,
  validation:null
};
const FIXED_CREATORS={
  peiqi:{creatorId:'creator_001',name:'波塞冬'},
  momo:{creatorId:'creator_002',name:'狗娃'},
  mengmeng:{creatorId:'creator_003',name:'阿浩'},
  qiaozhi:{creatorId:'creator_004',name:'杰瑞'},
  tiancai:{creatorId:'creator_005',name:'天才'},
  nvdi:{creatorId:'creator_006',name:'女帝'}
};
const prepBootstrap=window.__KG_DIRECT_BOOTSTRAP__||{};
const prepRuntime={
  dirty:false,saveInFlight:false,
  draftId:'',draftRevision:0,draftTitle:'',
  creatorProfile:null,deviceProfile:null,lastBatchId:'',
  serverActor:prepBootstrap.authenticated?(prepBootstrap.authUser||{username:prepBootstrap.username}):null,
  serverContentRevision:Number(prepBootstrap.contentRevision||0),
  serverBankId:'',serverBankRevision:null,clientInstanceId:generateSystemId('prep_client'),
  lastIdempotencyKey:'',lastUploadFingerprint:'',serverBanks:[],
  editLeaseState:{questionId:'',mode:'local-new',connection:'online',canSave:true,readOnly:false,lockToken:'',message:''},
  theme:'default',auditTrail:[],
  issuedQuestionIds:new Set()
};
const PREP_DB_NAME='pmp_content_prep_studio_v1';
const PREP_DB_VERSION=1;
const PREP_DB_STORE='workspaces';
const UI_SETTINGS_KEY='ui-settings';
const AUDIT_TRAIL_KEY='audit-trail';
const THEMES=new Set(['default','sakura','mint','sunshine','grape','ocean']);

function updateWorkspaceSaveStatus(message='',kind=''){
  const header=document.getElementById('hdrSaveStatus'),local=document.getElementById('localSaveStatus');
  let text=message;
  if(!text){
    if(prepRuntime.saveInFlight)text='正在保存共享草稿…';
    else if(prepRuntime.dirty)text='共享草稿有未保存修改';
    else if(prepRuntime.draftId)text=`正在编辑共享草稿：${prepRuntime.draftTitle||'未命名草稿'}`;
    else text='请选择或新建共享草稿';
  }
  if(header)header.textContent=text;
  if(local){local.textContent=text;local.className='save-status '+(kind||(prepRuntime.dirty?'warn':prepRuntime.draftId?'good':''))}
}
function markWorkspaceDirty(){prepRuntime.dirty=true;updateWorkspaceSaveStatus()}
function openPrepDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('当前浏览器不支持设备设置存储'));return}
    let req;try{req=indexedDB.open(PREP_DB_NAME,PREP_DB_VERSION)}catch(err){reject(err);return}
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PREP_DB_STORE))db.createObjectStore(PREP_DB_STORE,{keyPath:'id'})};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('无法打开设备设置存储'));
  });
}
async function prepDbPut(record){
  const db=await openPrepDb();return new Promise((resolve,reject)=>{const tx=db.transaction(PREP_DB_STORE,'readwrite');tx.objectStore(PREP_DB_STORE).put(record);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{const err=tx.error;db.close();reject(err||new Error('本地保存失败'))};tx.onabort=tx.onerror});
}
async function prepDbGet(key){
  const db=await openPrepDb();return new Promise((resolve,reject)=>{const tx=db.transaction(PREP_DB_STORE,'readonly'),req=tx.objectStore(PREP_DB_STORE).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('读取设备设置失败'));tx.oncomplete=()=>db.close()});
}
async function prepDbDelete(key){
  const db=await openPrepDb();return new Promise((resolve,reject)=>{const tx=db.transaction(PREP_DB_STORE,'readwrite');tx.objectStore(PREP_DB_STORE).delete(key);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{const err=tx.error;db.close();reject(err||new Error('删除设备设置失败'))}});
}

function applyTheme(theme,{persist=false}={}){
  theme=THEMES.has(theme)?theme:'default';prepRuntime.theme=theme;
  if(theme==='default')document.body.removeAttribute('data-theme');else document.body.setAttribute('data-theme',theme);
  const sel=document.getElementById('themeSelect');if(sel)sel.value=theme;
  if(persist)prepDbPut({id:UI_SETTINGS_KEY,theme,updatedAt:nowIso()}).catch(()=>{});
}
async function initThemeSettings(){
  try{const row=await prepDbGet(UI_SETTINGS_KEY);applyTheme(row?.theme||'default')}
  catch(_err){applyTheme('default')}
}
window.addEventListener('beforeunload',e=>{if(!prepRuntime.dirty)return;e.preventDefault();e.returnValue=''});


function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function clone(v){return JSON.parse(JSON.stringify(v))}
function uid(prefix='id'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function nowIso(){return new Date().toISOString()}

function randomUuidV4(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const a=new Uint8Array(16);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(a);
  else for(let i=0;i<a.length;i++)a[i]=Math.floor(Math.random()*256);
  a[6]=(a[6]&0x0f)|0x40;a[8]=(a[8]&0x3f)|0x80;
  const h=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function generateSystemId(prefix){return `${prefix}_${randomUuidV4()}`}
function registerQuestionId(id){id=String(id||'').trim();if(id)prepRuntime.issuedQuestionIds.add(id);return id}
function generateQuestionId(){
  let id;do{id=generateSystemId('q')}while(prepRuntime.issuedQuestionIds.has(id)||state.questionBank.questions.some(q=>q.id===id));
  return registerQuestionId(id);
}
function generateBatchId(){const id=generateSystemId('batch');prepRuntime.lastBatchId=id;return id}

const SHA256_K=[
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function rotr32(x,n){return (x>>>n)|(x<<(32-n))}
function sha256Hex(input){
  const data=new TextEncoder().encode(String(input??'')),bitLen=data.length*8;
  const pad=(64-((data.length+1+8)%64))%64,total=data.length+1+pad+8,bytes=new Uint8Array(total);
  bytes.set(data);bytes[data.length]=0x80;
  const view=new DataView(bytes.buffer);
  view.setUint32(total-8,Math.floor(bitLen/4294967296),false);view.setUint32(total-4,bitLen>>>0,false);
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const w=new Uint32Array(64);
  for(let off=0;off<total;off+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(off+i*4,false);
    for(let i=16;i<64;i++){
      const s0=(rotr32(w[i-15],7)^rotr32(w[i-15],18)^(w[i-15]>>>3))>>>0;
      const s1=(rotr32(w[i-2],17)^rotr32(w[i-2],19)^(w[i-2]>>>10))>>>0;
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){
      const S1=(rotr32(e,6)^rotr32(e,11)^rotr32(e,25))>>>0,ch=((e&f)^((~e)&g))>>>0;
      const t1=(h+S1+ch+SHA256_K[i]+w[i])>>>0;
      const S0=(rotr32(a,2)^rotr32(a,13)^rotr32(a,22))>>>0,maj=((a&b)^(a&c)^(b&c))>>>0;
      const t2=(S0+maj)>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
    h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(x=>x.toString(16).padStart(8,'0')).join('');
}
function normalizedContentText(v){return String(v||'').trim().replace(/\s+/g,' ')}
function canonicalQuestionContent(q){
  return JSON.stringify({
    stem:normalizedContentText(questionStem(q)),
    options:(q.options||[]).slice(0,4).map(o=>({id:String(o.id||''),text:normalizedContentText(o.text)})),
    correctAnswer:String(q.correctAnswer||'')
  });
}
function computeQuestionContentHash(q){return 'sha256:'+sha256Hex(canonicalQuestionContent(q))}
function canonicalDuplicateText(v){return String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase()}
function canonicalQuestionDuplicateSignature(q={}){
  const primaryStem=questionStem(q)||String(q?.translations?.en?.stemParts?.map(part=>part?.text||'').join('')||'');
  return JSON.stringify({stem:canonicalDuplicateText(primaryStem),options:(q.options||[]).map(option=>[canonicalDuplicateText(option?.id),canonicalDuplicateText(option?.text)]),correctAnswer:canonicalDuplicateText(q.correctAnswer)});
}
function preflightQuestionDuplicates(incoming,existing=[]){
  const known=new Set((existing||[]).map(canonicalQuestionDuplicateSignature)),batch=new Set(),unique=[],duplicates=[];
  (incoming||[]).forEach((question,index)=>{const signature=canonicalQuestionDuplicateSignature(question),source=known.has(signature)?'existing':batch.has(signature)?'batch':'';if(source)duplicates.push({index:index+1,title:String(question?.title||'未命名题目'),source,signature});else{batch.add(signature);unique.push(question)}});
  return {unique,duplicates,existingCount:duplicates.filter(item=>item.source==='existing').length,batchCount:duplicates.filter(item=>item.source==='batch').length};
}
function currentIdentitySnapshot(){
  const c=prepRuntime.creatorProfile||{},d=prepRuntime.deviceProfile||{};
  return {creatorId:c.creatorId||'',creatorName:c.name||'',deviceId:d.deviceId||''};
}

function auditValidationSnapshot(){
  const v=state.validation||null;
  return v?.metrics?{errors:Number(v.metrics.errors||0),warnings:Number(v.metrics.warnings||0)}:{errors:null,warnings:null};
}
function auditTrailPayload(){
  return {
    schemaVersion:1,
    format:'pmp-content-prep-export-audit-v1',
    exportedAt:nowIso(),
    exportedBy:{...currentIdentitySnapshot()},
    deviceId:prepRuntime.deviceProfile?.deviceId||'',
    application:{name:'PMP Content Prep Studio',version:VERSION,architecture:'service-layer-v1'},
    eventCount:prepRuntime.auditTrail.length,
    events:clone(prepRuntime.auditTrail)
  };
}
function buildAuditEvent({exportType,fileName,payload,details={}}){
  const identity=currentIdentitySnapshot(),json=JSON.stringify(payload);
  return {
    auditId:generateSystemId('audit'),
    eventType:'export',
    exportType:String(exportType||'unknown'),
    exportedAt:nowIso(),
    creatorId:identity.creatorId||'',
    creatorName:identity.creatorName||'',
    deviceId:identity.deviceId||'',
    batchId:prepRuntime.lastBatchId||'',
    applicationVersion:VERSION,
    fileName:String(fileName||''),
    payloadHash:'sha256:'+sha256Hex(json),
    payloadBytes:new TextEncoder().encode(json).length,
    questionBankId:state.questionBank?.id||'',
    questionBankName:state.questionBank?.name||'',
    questionCount:state.questionBank?.questions?.length||0,
    validation:auditValidationSnapshot(),
    details:clone(details||{})
  };
}
async function persistAuditTrail(){
  const max=2000;if(prepRuntime.auditTrail.length>max)prepRuntime.auditTrail=prepRuntime.auditTrail.slice(-max);
  try{await prepDbPut({id:AUDIT_TRAIL_KEY,updatedAt:nowIso(),events:prepRuntime.auditTrail})}catch(_err){}
}
async function loadAuditTrail(){
  try{const row=await prepDbGet(AUDIT_TRAIL_KEY);prepRuntime.auditTrail=Array.isArray(row?.events)?row.events:[]}
  catch(_err){prepRuntime.auditTrail=[]}
  renderAuditTrail();
}
function recordAuditEvent(options){
  const event=buildAuditEvent(options);prepRuntime.auditTrail.push(event);persistAuditTrail();renderAuditTrail();return event;
}
function renderAuditTrail(){
  const box=document.getElementById('auditList'),count=document.getElementById('auditCount');
  if(count)count.textContent=`${prepRuntime.auditTrail.length} 条`;
  if(!box)return;
  const rows=prepRuntime.auditTrail.slice(-50).reverse();
  if(!rows.length){box.innerHTML='<div class="audit-empty">尚无导出审计记录。完成一次题库/内容包/联想库等正式导出后会自动出现。</div>';return}
  box.innerHTML=rows.map(e=>`<div class="audit-row">
    <div><b>${esc(new Date(e.exportedAt).toLocaleString())}</b><div class="muted tiny">${esc(e.creatorName||e.creatorId||'未选择')}</div></div>
    <div>${esc(e.exportType)}<div class="muted tiny">${esc(e.applicationVersion)}</div></div>
    <div title="${esc(e.fileName)}">${esc(e.fileName)}<div class="audit-hash" title="${esc(e.payloadHash)}">${esc(e.payloadHash)}</div></div>
    <div>${Number(e.questionCount||0)} 题<div class="muted tiny">${e.validation?.errors??'—'}E / ${e.validation?.warnings??'—'}W</div></div>
  </div>`).join('');
}
async function clearAuditTrail(){
  if(!confirm('清空当前浏览器设备上的全部导出审计记录？已经导出的审计日志文件不会受影响。'))return;
  prepRuntime.auditTrail=[];try{await prepDbDelete(AUDIT_TRAIL_KEY)}catch(_err){}renderAuditTrail();toast('本机导出审计记录已清空');
}

function stampQuestionOrigin(q,{batchId='',source='manual',forceOrigin=false,parentQuestionId=''}={}){
  q.metadata=q.metadata||{};const now=nowIso(),identity=currentIdentitySnapshot(),batch=batchId||generateBatchId();
  if(forceOrigin||!q.metadata.origin){
    q.metadata.origin={...identity,batchId:batch,source,createdAt:now};
    if(parentQuestionId)q.metadata.origin.parentQuestionId=parentQuestionId;
  }
  q.metadata.lastImport={...identity,batchId:batch,source,importedAt:now};
  q.metadata.idSystem={schemaVersion:1,strategy:'uuid-v4',generatedBy:`PMP Content Prep Studio v${VERSION}`};
  q.contentHash=computeQuestionContentHash(q);
  registerQuestionId(q.id);
  return q;
}
function stampImportedQuestions(questions,source){
  const batchId=generateBatchId();
  // P4.5.29 差异 16：外部导入一律强制 qualityConfirmed=false，只有教师操作可以设为 true
  if(typeof forceExternalFamilyUnconfirmed==='function')forceExternalFamilyUnconfirmed(questions);
  (questions||[]).forEach(q=>stampQuestionOrigin(q,{batchId,source,forceOrigin:!q.metadata?.origin}));
  return batchId;
}

function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function cleanList(v){if(Array.isArray(v))return v.map(x=>String(x).trim()).filter(Boolean);return String(v||'').split(/[\n,，、;；|]/).map(x=>x.trim()).filter(Boolean)}
function unique(a){return [...new Set(a.filter(Boolean))]}
function countOccurrences(text,term){if(!term)return 0;let n=0,i=0;while((i=String(text).indexOf(term,i))>=0){n++;i+=Math.max(1,term.length)}return n}
function downloadText(text,name,type='text/plain;charset=utf-8'){const blob=new Blob([String(text??'')],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500)}
function downloadJson(obj,name,options={}){
  const json=JSON.stringify(obj,null,2),blob=new Blob([json],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
  if(options.auditType)recordAuditEvent({exportType:options.auditType,fileName:name,payload:obj,details:options.details||{}});
}
function readJsonFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{try{resolve(JSON.parse(String(r.result||'').replace(/^\ufeff/,'')))}catch(e){reject(e)}};r.onerror=()=>reject(r.error);r.readAsText(file,'utf-8')})}

const DEVICE_PROFILE_KEY='device-profile';

function blankDeviceProfile(){
  return {deviceId:generateSystemId('device'),createdAt:nowIso(),updatedAt:nowIso()};
}
function renderFixedCreator(){
  const c=prepRuntime.creatorProfile||{},d=prepRuntime.deviceProfile||{};
  const hdr=document.getElementById('hdrCreator');if(hdr)hdr.textContent='制作人：'+(c.name||'未选择');
  const name=document.getElementById('creatorFixedName');if(name)name.textContent=c.name||'尚未选择';
  const cid=document.getElementById('creatorFixedId');if(cid)cid.textContent=c.creatorId||'—';
  const did=document.getElementById('deviceFixedId');if(did)did.textContent=d.deviceId||'正在初始化…';
}
function showCreatorGate(){document.getElementById('creatorGate')?.classList.remove('hidden')}
function hideCreatorGate(){document.getElementById('creatorGate')?.classList.add('hidden')}
function selectFixedCreator(key){
  const creator=FIXED_CREATORS[key];if(!creator)return;
  prepRuntime.creatorProfile={creatorId:creator.creatorId,name:creator.name,selectedAt:nowIso()};
  renderFixedCreator();hideCreatorGate();toast(`当前制作人：${creator.name}`);
}
async function initDeviceProfile(){
  try{
    const row=await prepDbGet(DEVICE_PROFILE_KEY);
    prepRuntime.deviceProfile=row?.profile||blankDeviceProfile();
    if(!row)await prepDbPut({id:DEVICE_PROFILE_KEY,profile:prepRuntime.deviceProfile});
  }catch(_err){prepRuntime.deviceProfile=prepRuntime.deviceProfile||blankDeviceProfile()}
  renderFixedCreator();
}
function requireCreatorSelection(){
  prepRuntime.creatorProfile=null;renderFixedCreator();showCreatorGate();
}
function parseKeywordPasteSpecs(value,level){
  const out=[];String(value||'').split(/[；;]/).map(x=>x.trim()).filter(Boolean).forEach(part=>{
    const pieces=part.split('=>'),term=String(pieces[0]||'').trim();if(!term)return;const details=String(pieces.slice(1).join('=>')||'').split('|').map(x=>x.trim()),recallNodeId=details[0]||'',role=level==='core'?(details[1]||'concept-anchor'):'context',reason=level==='core'?(details.slice(2).join('|')||''):'',rn=recallNodeId?recallIndex().byId.get(recallNodeId):null;
    out.push({id:uid('kw'),text:term,textEn:'',keywordLevel:level,isCore:level==='core',type:level==='core'?'core-keyword':'recall-keyword',clueRole:'true',sourceType:'stem',sourceOptionId:'',recallNodeId,recallEntryLabel:rn?.title||'',solutionRole:role,coreReason:reason,conceptIds:[],explain:'',sourceMode:'word-paste-keyword-v2',matchLocations:[]});
  });return out;
}
function parsePastedQuestionText(raw){
  raw=String(raw||'').replace(/\r\n?/g,'\n').trim();if(!raw)return [];
  let blocks=raw.split(/\n(?=\s*(?:【\s*题目\s*\d+\s*】|题目\s*\d+\s*[:：.]|Q(?:uestion)?\s*\d+\s*[:：.]))/i).map(x=>x.trim()).filter(Boolean);
  if(blocks.length===1){const markerCount=(raw.match(/(?:^|\n)\s*【\s*题目\s*\d+\s*】/g)||[]).length;if(markerCount>1)blocks=raw.split(/(?=(?:^|\n)\s*【\s*题目\s*\d+\s*】)/g).map(x=>x.trim()).filter(Boolean)}
  const out=[];
  blocks.forEach((block,bi)=>{
    const lines=block.split('\n').map(x=>x.trim()).filter(Boolean);
    let title='',difficulty='中等',domain='',topic='',stage='',tags=[],stem=[],analysis=[],answer='',mode='stem',enTitle='',enStem=[],enAnalysis=[],primaryNodeId='',normalKw='',coreKw='',principleIds=[];
    const opts={A:'',B:'',C:'',D:''},traps={A:'',B:'',C:'',D:''},enOpts={A:'',B:'',C:'',D:''},enFeedback={A:'',B:'',C:'',D:''},optionPrinciples={A:[],B:[],C:[],D:[]};
    for(const line of lines){
      if(/^【\s*题目\s*\d+\s*】$/.test(line)||/^题目\s*\d+\s*[:：.]?$/.test(line)||/^Q(?:uestion)?\s*\d+\s*[:：.]?$/i.test(line))continue;
      let mm=line.match(/^(?:ID|题目ID)\s*[:：]\s*(.*)$/i);if(mm){continue}
      mm=line.match(/^标题\s*[:：]\s*(.*)$/);if(mm){title=mm[1].trim();continue}
      mm=line.match(/^难度\s*[:：]\s*(.*)$/);if(mm){difficulty=mm[1].trim()||'中等';continue}
      mm=line.match(/^(?:领域|Domain)\s*[:：]\s*(.*)$/i);if(mm){domain=mm[1].trim();continue}
      mm=line.match(/^(?:主题|Topic)\s*[:：]\s*(.*)$/i);if(mm){topic=mm[1].trim();continue}
      mm=line.match(/^(?:阶段|Stage)\s*[:：]\s*(.*)$/i);if(mm){stage=mm[1].trim();continue}
      mm=line.match(/^标签\s*[:：]\s*(.*)$/);if(mm){tags=cleanList(mm[1]);continue}
      mm=line.match(/^题干\s*[:：]\s*(.*)$/);if(mm){mode='stem';if(mm[1])stem.push(mm[1]);continue}
      mm=line.match(/^([A-DＡ-Ｄ])\s*[\.．、:：\)）]\s*(.*)$/i);if(mm){const letter={'Ａ':'A','Ｂ':'B','Ｃ':'C','Ｄ':'D'}[mm[1]]||mm[1].toUpperCase();opts[letter]=mm[2].trim();mode='option';continue}
      mm=line.match(/^([A-D])\s*(?:陷阱|Trap)\s*[:：]\s*(.*)$/i);if(mm){traps[mm[1].toUpperCase()]=mm[2].trim();continue}
      mm=line.match(/^(?:正确答案|参考答案|答案|Answer)\s*[:：]\s*([A-DＡ-Ｄ])/i);if(mm){answer=({'Ａ':'A','Ｂ':'B','Ｃ':'C','Ｄ':'D'}[mm[1]]||mm[1].toUpperCase());mode='answer';continue}
      mm=line.match(/^(?:题目解析|解析)\s*[:：]\s*(.*)$/);if(mm){mode='analysis';if(mm[1])analysis.push(mm[1]);continue}
      mm=line.match(/^(?:English Title|英文标题)\s*[:：]\s*(.*)$/i);if(mm){enTitle=mm[1].trim();mode='en-title';continue}
      mm=line.match(/^(?:English Stem|英文题干)\s*[:：]\s*(.*)$/i);if(mm){mode='en-stem';if(mm[1])enStem.push(mm[1]);continue}
      mm=line.match(/^([A-D])(?:_EN|\s+EN)\s*[:：]\s*(.*)$/i);if(mm){enOpts[mm[1].toUpperCase()]=mm[2].trim();mode='en-option';continue}
      mm=line.match(/^(?:English Analysis|英文解析|Analysis EN)\s*[:：]\s*(.*)$/i);if(mm){mode='en-analysis';if(mm[1])enAnalysis.push(mm[1]);continue}
      mm=line.match(/^([A-D])(?:反馈EN|反馈\s*EN|Feedback\s*EN)\s*[:：]\s*(.*)$/i);if(mm){enFeedback[mm[1].toUpperCase()]=mm[2].trim();continue}
      mm=line.match(/^(?:主知识点ID|PrimaryNodeId|Primary Node ID)\s*[:：]\s*(.*)$/i);if(mm){primaryNodeId=mm[1].trim();mode='meta';continue}
      mm=line.match(/^普通关键词\s*[:：]\s*(.*)$/);if(mm){normalKw=mm[1].trim();mode='meta';continue}
      mm=line.match(/^核心关键词\s*[:：]\s*(.*)$/);if(mm){coreKw=mm[1].trim();mode='meta';continue}
      mm=line.match(/^(?:题干原则IDs|题干原则ID|StemPrincipleIds|原则IDs|原则ID|PrincipleIds)\s*[:：]\s*(.*)$/i);if(mm){principleIds=cleanList(mm[1]);mode='meta';continue}
      mm=line.match(/^([A-D])原则\s*[:：]\s*(.*)$/);if(mm){optionPrinciples[mm[1].toUpperCase()]=cleanList(mm[2]);mode='meta';continue}
      if(mode==='analysis')analysis.push(line);else if(mode==='en-stem')enStem.push(line);else if(mode==='en-analysis')enAnalysis.push(line);else if(mode==='stem')stem.push(line);
    }
    if(stem.length||Object.values(opts).some(Boolean)){
      const clues=[...parseKeywordPasteSpecs(normalKw,'normal'),...parseKeywordPasteSpecs(coreKw,'core')];
      const nq=normalizeQuestion({title:title||`导入题目 ${bi+1}`,difficulty,domain,topic,tags,stage,stemParts:[{text:stem.join(' ')}],options:['A','B','C','D'].map(letter=>({id:letter,text:opts[letter],trap:traps[letter]})),correctAnswer:answer||'A',analysis:analysis.join('\n'),translations:{en:{title:enTitle,stemParts:[{text:enStem.join(' ')}],options:['A','B','C','D'].map(letter=>({id:letter,text:enOpts[letter]})),analysis:enAnalysis.join('\n'),optionFeedback:enFeedback}},clues,metadata:{knowledge:{primaryNodeId,relatedNodeIds:[],mappingStatus:primaryNodeId?'confirmed':'unmapped',pathSnapshot:[]},stemPrincipleIds:principleIds,optionPrincipleMap:optionPrinciples}},bi,state.questionBank.subject||'PMP');
      if(primaryNodeId&&state.knowledgeTree?.map.has(primaryNodeId))nq.metadata.knowledge.pathSnapshot=state.knowledgeTree.pathFor(primaryNodeId);
      nq.clues.forEach(c=>c.conceptIds=primaryNodeId?[primaryNodeId]:[]);recomputeKeywordLocations(nq);syncQuestionPrinciples(nq);nq.tags=unique((nq.tags||[]).map(canonicalTagName));nq.metadata.tagPaths=nq.tags.map(tagPathFor).filter(Boolean);out.push(nq);
    }
  });return out;
}

function normalizeTree(payload){
  const tax=payload?.taxonomy?.nodes?payload.taxonomy:(payload?.nodes?payload:null);
  if(!tax||!Array.isArray(tax.nodes))throw new Error('未找到 taxonomy.nodes。');
  const nodes=tax.nodes.map(n=>({...n,id:String(n.id||''),parentId:n.parentId==null?null:String(n.parentId)})).filter(n=>n.id);
  const map=new Map(nodes.map(n=>[n.id,n]));
  const title=n=>typeof n.title==='object'?(n.title.zh||n.title.en||''):String(n.title||'');
  const pathFor=id=>{const out=[];let cur=map.get(id),seen=new Set();while(cur&&!seen.has(cur.id)){seen.add(cur.id);out.push(title(cur));cur=cur.parentId?map.get(cur.parentId):null}return out.reverse()};
  return {id:String(tax.id||''),subjectId:String(tax.subjectId||'subject-pmp'),name:typeof tax.name==='object'?(tax.name.zh||tax.name.en||''):(tax.name||''),version:Number(tax.version||1),nodes,map,title,pathFor};
}
function normalizeRecall(payload){
  if(!payload||typeof payload!=='object')throw new Error('联想库必须是 JSON 对象。');
  const nodes=(Array.isArray(payload.nodes)?payload.nodes:[]).map((n,i)=>({
    id:String(n.id||uid('recall')),
    title:String(n.title||'未命名节点'),
    titleEn:String(n.titleEn||''),
    aliases:unique(cleanList(n.aliases)),
    prompt:String(n.prompt||''),
    promptEn:String(n.promptEn||''),
    hint:String(n.hint||''),
    hintEn:String(n.hintEn||''),
    priority:Number(n.priority||0),
    metadata:n.metadata&&typeof n.metadata==='object'?clone(n.metadata):{}
  }));
  const ids=new Set(nodes.map(n=>n.id));
  const edges=(Array.isArray(payload.edges)?payload.edges:[]).map(e=>({
    id:String(e.id||uid('edge')),from:String(e.from||''),to:String(e.to||''),priority:Number(e.priority||0),label:String(e.label||'关联'),
    metadata:e.metadata&&typeof e.metadata==='object'?clone(e.metadata):{}
  })).filter(e=>ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to);
  return {schemaVersion:1,nodes,edges,updatedAt:String(payload.updatedAt||nowIso())};
}
function normalizePrinciples(payload){
  const raw=Array.isArray(payload)?payload:(Array.isArray(payload?.items)?payload.items:[]);
  return {schemaVersion:1,items:raw.map((item,i)=>{const name=String(item?.name||item?.title||'未命名原则').trim()||'未命名原则';return {id:String(item?.id||('principle-'+i+'-'+Date.now().toString(36))),name,status:String(item?.status||'active')==='inactive'?'inactive':'active',confusablePrincipleIds:unique((item?.confusablePrincipleIds||[]).map(String)),createdAt:Number(item?.createdAt||Date.now()),updatedAt:Number(item?.updatedAt||Date.now())}}),updatedAt:Number(payload?.updatedAt||Date.now())};
}
function normalizePresets(payload){
  const raw=Array.isArray(payload)?payload:(Array.isArray(payload?.items)?payload.items:[]);
  return {schemaVersion:1,items:raw.map((item,i)=>({id:String(item?.id||('preset-'+i+'-'+Date.now().toString(36))),principleId:String(item?.principleId||''),title:String(item?.title||'').trim(),content:String(item?.content||item?.description||'').trim(),status:['draft','active','inactive'].includes(String(item?.status||''))?String(item.status):'draft',version:Math.max(1,Number(item?.version||1)),createdAt:Number(item?.createdAt||Date.now()),updatedAt:Number(item?.updatedAt||Date.now())})),updatedAt:Number(payload?.updatedAt||Date.now())};
}
function normalizePrincipleCardBundle(payload={}){
  const principles=normalizePrinciples(payload.principles||payload.principleRepository||{});
  const synthesisPresets=normalizePresets(payload.synthesisPresets||payload.presets||payload.synthesisPresetRepository||{});
  const principlesById=new Map(principles.items.map(item=>[item.id,item])),seenPresetPrinciples=new Set();
  synthesisPresets.items.forEach(preset=>{
    if(!principlesById.has(preset.principleId))throw new Error(`归纳卡引用了不存在的原则：${preset.principleId}`);
    if(seenPresetPrinciples.has(preset.principleId))throw new Error(`原则 ${preset.principleId} 存在重复归纳卡`);
    seenPresetPrinciples.add(preset.principleId);
  });
  principles.items.forEach(principle=>{if(!seenPresetPrinciples.has(principle.id))throw new Error(`原则 ${principle.id} 缺少对应归纳卡`)});
  synthesisPresets.items=synthesisPresets.items.map(preset=>({...preset,title:'原则：'+principlesById.get(preset.principleId).name}));
  return {principles,synthesisPresets};
}
function principleCardBundlePayload(principles=state.principles,synthesisPresets=state.synthesisPresets){
  const pair=normalizePrincipleCardBundle({principles,synthesisPresets});
  return {principleCardBundleVersion:1,format:'kg-principle-card-bundle-v1',generatedBy:`PMP Content Prep Studio v${VERSION}`,generatedAt:nowIso(),principles:pair.principles,synthesisPresets:pair.synthesisPresets};
}
function baseTagSlotEntries(config={}){
  const out=[];BASE_TAG_GROUPS.forEach(g=>g.categories.forEach(c=>c.options.forEach((baseLabel,i)=>{
    const legacySlot=legacyTagSlotKey(g,c,i),slot=semanticTagSlot(legacySlot),label=String(config.names?.[slot]||config.names?.[legacySlot]||baseLabel);
    out.push({slot,legacySlot,baseLabel,label,groupId:g.id,categoryId:c.id});
  })));return out;
}
function resolveAliasMapValue(value,map){
  let current=String(value||'').trim(),seen=new Set();while(map[current]&&!seen.has(current)){seen.add(current);current=String(map[current]||current).trim()||current}return current;
}
function syncFlatTagAliases(config=state.tagConfig){
  config=config||{};const flat={...(config.looseAliases||{})},slotLabels=new Map(baseTagSlotEntries(config).map(x=>[x.slot,x.label]));
  Object.entries(config.slotAliases||{}).forEach(([slot,items])=>{const target=slotLabels.get(slot);if(!target)return;unique(cleanList(items)).forEach(alias=>{if(alias&&alias!==target)flat[alias]=target})});
  config.aliases=flat;return config;
}
function normalizeTagConfig(payload){
  payload=payload&&typeof payload==='object'?payload:{};
  const names={};Object.entries(payload.names&&typeof payload.names==='object'?payload.names:{}).forEach(([slot,value])=>names[semanticTagSlot(slot)]=value);
  const slotAliases={};Object.entries(payload.slotAliases&&typeof payload.slotAliases==='object'?payload.slotAliases:{}).forEach(([slot,items])=>slotAliases[semanticTagSlot(slot)]=unique(cleanList(items)));
  const config={
    schemaVersion:3,slotIdStrategy:'global-semantic-v1',
    names,
    groupNames:payload.groupNames&&typeof payload.groupNames==='object'?{...payload.groupNames}:{},
    categoryNames:payload.categoryNames&&typeof payload.categoryNames==='object'?{...payload.categoryNames}:{},
    aliases:payload.aliases&&typeof payload.aliases==='object'?{...payload.aliases}:{},
    slotAliases,
    looseAliases:payload.looseAliases&&typeof payload.looseAliases==='object'?{...payload.looseAliases}:{}
  };
  const slots=baseTagSlotEntries(config),slotByLabel=new Map(slots.map(x=>[x.label,x.slot])),represented=new Set(Object.values(config.slotAliases).flatMap(cleanList));
  Object.entries(config.aliases).forEach(([from,to])=>{
    if(represented.has(from))return;
    const resolved=resolveAliasMapValue(to,config.aliases),slot=slotByLabel.get(resolved)||slotByLabel.get(String(to||'').trim());
    if(slot)config.slotAliases[slot]=unique([...(config.slotAliases[slot]||[]),from]);
    else if(!(from in config.looseAliases))config.looseAliases[from]=to;
  });
  Object.keys(config.slotAliases).forEach(slot=>config.slotAliases[semanticTagSlot(slot)]=unique(cleanList(config.slotAliases[slot])));
  return syncFlatTagAliases(config);
}
function effectiveTagGroups(){
  const c=state.tagConfig||{},groups=clone(BASE_TAG_GROUPS);
  groups.forEach(g=>{g.label=String(c.groupNames?.[tagGroupKey(g)]||g.label);g.categories.forEach(cat=>{
    cat.label=String(c.categoryNames?.[tagCategoryKey(g,cat)]||cat.label);
    cat.options=cat.options.map((name,i)=>String(c.names?.[tagSlotKey(g,cat,i)]||name));
  })});return groups;
}
function tagCatalogEntries(){const out=[];effectiveTagGroups().forEach(g=>g.categories.forEach(c=>c.options.forEach((label,i)=>{
  const legacySlot=legacyTagSlotKey(g,c,i),slot=semanticTagSlot(legacySlot);
  out.push({groupId:g.id,group:g.label,categoryId:c.id,category:c.label,label,slot,legacySlot});
})));return out}
function canonicalTagName(value){let current=String(value||'').trim(),seen=new Set(),aliases=state.tagConfig?.aliases||{};while(aliases[current]&&!seen.has(current)){seen.add(current);current=String(aliases[current]||current).trim()||current}return current}
function tagPathFor(label){const canonical=canonicalTagName(label);return tagCatalogEntries().find(x=>x.label===canonical)||null}
function principleById(id){return state.principles.items.find(x=>x.id===String(id))||null}
function presetByPrincipleId(id){return state.synthesisPresets.items.find(x=>x.principleId===String(id))||null}
function normalizeOptionPrincipleMap(value,optionIds=[]){
  const out={},allowed=new Set((optionIds||[]).map(String).filter(Boolean));
  if(value&&typeof value==='object')Object.entries(value).forEach(([key,ids])=>{const optionId=String(key||'');if(!allowed.size||allowed.has(optionId))out[optionId]=unique((Array.isArray(ids)?ids:cleanList(ids)).map(String))});
  return out;
}
function syncQuestionPrinciples(q){
  q.metadata=q.metadata||{};
  const legacy=unique([...(Array.isArray(q.principleIds)?q.principleIds:[]),...(Array.isArray(q.metadata.principleIds)?q.metadata.principleIds:[])].map(String));
  const stem=unique(Array.isArray(q.metadata.stemPrincipleIds)&&q.metadata.stemPrincipleIds.length?q.metadata.stemPrincipleIds:legacy);
  const optionPrincipleMap=normalizeOptionPrincipleMap(q.metadata.optionPrincipleMap,(q.options||[]).map(option=>option.id));
  q.metadata.stemPrincipleIds=stem;
  q.metadata.optionPrincipleMap=optionPrincipleMap;
  q.metadata.principleIds=unique([...stem,...Object.values(optionPrincipleMap).flat()].map(String));
  return q.metadata;
}
function refreshQuestionTagPaths(){state.questionBank.questions.forEach(q=>{q.tags=unique((q.tags||[]).map(canonicalTagName));q.metadata=q.metadata||{};q.metadata.tagPaths=q.tags.map(tagPathFor).filter(Boolean)})}

function normalizeOption(o,i,correct){
  const id=String(o?.id||String.fromCharCode(65+i));
  return {id,text:String(o?.text||''),trap:String(o?.trap||''),correct:id===String(correct||'')||!!o?.correct};
}
function questionStem(q){return Array.isArray(q?.stemParts)?q.stemParts.map(p=>String(p?.text||'')).join(''):String(q?.stem||'')}
function englishStem(q){return Array.isArray(q?.translations?.en?.stemParts)?q.translations.en.stemParts.map(p=>String(p?.text||'')).join(''):String(q?.stemEn||'')}

function normalizeKeywordLevel(clue,q){
  const mirror=q?.metadata?.keywordSystemV2?.keywords?.find(x=>String(x.clueId||x.id)===String(clue.id||''));
  const level=String(clue.keywordLevel||mirror?.keywordLevel||'normal');
  return level==='core'?'core':'normal';
}
function normalizeQuestion(q,i=0,subject='PMP'){
  q=q&&typeof q==='object'?clone(q):{};
  const options=(Array.isArray(q.options)?q.options:[]).map((o,idx)=>normalizeOption(o,idx,q.correctAnswer));
  while(options.length<4)options.push(normalizeOption({id:String.fromCharCode(65+options.length),text:''},options.length,q.correctAnswer));
  const correct=String(q.correctAnswer||options.find(o=>o.correct)?.id||'A');
  options.forEach(o=>o.correct=o.id===correct);
  const clues=(Array.isArray(q.clues)?q.clues:[]).map((c,idx)=>{
    const level=normalizeKeywordLevel(c,q);
    const mirror=q?.metadata?.keywordSystemV2?.keywords?.find(x=>String(x.clueId||x.id)===String(c.id||''));
    return {
      ...c,
      id:String(c.id||uid('kw')),
      text:String(c.text||c.keyword||'').trim(),
      textEn:String(c.textEn||''),
      keywordLevel:level,
      isCore:level==='core',
      solutionRole:String(c.solutionRole||mirror?.solutionRole||(level==='core'?'concept-anchor':'context')),
      coreReason:String(c.coreReason||mirror?.coreReason||''),
      sourceType:String(c.sourceType||'stem'),
      sourceOptionId:String(c.sourceOptionId||''),
      recallNodeId:String(c.recallNodeId||''),
      recallEntryLabel:String(c.recallEntryLabel||''),
      matchLocations:Array.isArray(c.matchLocations)?clone(c.matchLocations):[]
    };
  }).filter(c=>c.text);
  const knowledge=q?.metadata?.knowledge&&typeof q.metadata.knowledge==='object'?clone(q.metadata.knowledge):{};
  delete knowledge.taxonomyId; delete knowledge.taxonomyVersion;
  const systemQuestionId=registerQuestionId(String(q.id||generateQuestionId()));
  return {
    ...q,
    id:systemQuestionId,
    title:String(q.title||'未命名题目'),
    type:String(q.type||'single_choice'),
    subject:String(q.subject||subject||'PMP'),
    difficulty:typeof normalizeQuestionDifficulty==='function'?normalizeQuestionDifficulty(q.difficulty):String(q.difficulty||'中等'),
    domain:String(q.domain||''),
    topic:String(q.topic||''),
    tags:cleanList(q.tags),
    stage:String(q.stage||''),
    stemParts:[{text:questionStem(q)}],
    options,
    correctAnswer:correct,
    analysis:String(q.analysis||q.explanation||''),
    explanation:String(q.explanation||q.analysis||''),
    translations:{
      ...(q.translations&&typeof q.translations==='object'?q.translations:{}),
      en:{
        ...(q.translations?.en&&typeof q.translations.en==='object'?q.translations.en:{}),
        title:String(q.translations?.en?.title||q.titleEn||''),
        stemParts:[{text:englishStem(q)}],
        options:(Array.isArray(q.translations?.en?.options)?q.translations.en.options:[]).map((o,idx)=>({id:String(o?.id||String.fromCharCode(65+idx)),text:String(o?.text||'')})),
        analysis:String(q.translations?.en?.analysis||q.analysisEn||'')
      }
    },
    clues,
    reasoningSteps:Array.isArray(q.reasoningSteps)?clone(q.reasoningSteps):[],
    metadata:(()=>{const metadata={...(q.metadata&&typeof q.metadata==='object'?q.metadata:{}),tagPaths:Array.isArray(q.metadata?.tagPaths)?clone(q.metadata.tagPaths):[],subjectFacets:typeof normalizeQuestionFacets==='function'?normalizeQuestionFacets(q.metadata?.subjectFacets,q.subject||subject):(Array.isArray(q.metadata?.subjectFacets)?clone(q.metadata.subjectFacets):[]),questionFamily:typeof normalizeQuestionFamily==='function'?normalizeQuestionFamily(q.metadata?.questionFamily||{},systemQuestionId,q.difficulty):(q.metadata?.questionFamily||{}),knowledge};syncQuestionPrinciples({metadata,principleIds:q.principleIds,options});return metadata})(),
    lifecycle:q.lifecycle&&typeof q.lifecycle==='object'?clone(q.lifecycle):{status:'active',deletedAt:''},
    status:q.status&&typeof q.status==='object'?clone(q.status):{contentReady:false,keywordsReady:false,knowledgeReady:false,reasoningReady:false,published:false}
    ,serverRevision:Number(q.serverRevision)||null
    ,serverContentHash:String(q.serverContentHash||'')
    ,lastSyncedAt:String(q.lastSyncedAt||'')
    ,serverExportSnapshot:String(q.serverExportSnapshot||'')
  };
}
function normalizeBank(payload){
  let b=payload;
  if(Array.isArray(payload?.banks)&&payload.banks.length)b=payload.banks[0];
  if(Array.isArray(payload))b={name:'导入题库',subject:'PMP',questions:payload};
  if(!b||!Array.isArray(b.questions))throw new Error('题库缺少 questions 数组。');
  const subject=String(b.subject||'PMP');
  const questions=b.questions.map((q,i)=>{const nq=QuestionService.normalize(q,i,subject);syncQuestionPrinciples(nq);nq.tags=unique((nq.tags||[]).map(canonicalTagName));nq.metadata.tagPaths=nq.tags.map(tagPathFor).filter(Boolean);return nq});
  if(typeof resolveQuestionFamilies==='function')resolveQuestionFamilies(questions);
  return {
    id:String(b.id||b.bankId||generateSystemId('bank')),name:String(b.name||b.bankName||'PMP 题库'),subject,description:String(b.description||''),
    version:String(b.version||'1.0'),visibility:String(b.visibility||'private'),createdAt:Number(b.createdAt||Date.now()),updatedAt:Number(b.updatedAt||Date.now()),
    questions
  };
}
function normalizeContentBundle(payload){
  if(!payload||typeof payload!=='object')throw new Error('完整内容包必须是 JSON 对象。');
  const qb=payload.questionBank||payload.bank||(Array.isArray(payload.questions)?payload:null);if(!qb)throw new Error('完整内容包缺少 questionBank。');
  return {prepContentBundleVersion:Number(payload.prepContentBundleVersion||1),questionBank:normalizeBank(qb),principles:normalizePrinciples(payload.principles||{}),synthesisPresets:normalizePresets(payload.synthesisPresets||payload.presets||{}),tagConfig:normalizeTagConfig(payload.tagConfig||{}),subjectFacetRegistry:typeof normalizeSubjectFacetRegistry==='function'?normalizeSubjectFacetRegistry(payload.subjectFacetRegistry||{}):null,recallLibrary:payload.recallLibrary?normalizeRecall(payload.recallLibrary):null,knowledgeTree:payload.knowledgeTree?normalizeTree(payload.knowledgeTree):null};
}
function importContentBundle(payload){
  const b=ImportService.completeBundle(payload),report=preflightQuestionDuplicates(b.questionBank.questions,[]);
  if(report.duplicates.length&&!confirm(`检测到重复题目：已有重复 ${report.existingCount} 道，本批重复 ${report.batchCount} 道。\n是否自动清除后继续导入？`))return {ok:false,cancelled:true,report};
  b.questionBank.questions=report.unique;state.tagConfig=b.tagConfig;state.principles=b.principles;state.synthesisPresets=b.synthesisPresets;state.questionBank=b.questionBank;if(b.subjectFacetRegistry)state.subjectFacetRegistry=b.subjectFacetRegistry;if(b.recallLibrary)state.recallLibrary=b.recallLibrary;if(b.knowledgeTree)state.knowledgeTree=b.knowledgeTree;
  stampImportedQuestions(state.questionBank.questions,'complete-content-bundle');
  refreshQuestionTagPaths();state.questionBank.questions.forEach(syncQuestionPrinciples);state.currentQuestionId=state.questionBank.questions[0]?.id||'';state.demoQuestionId=state.currentQuestionId;state.currentRecallId=state.recallLibrary.nodes[0]?.id||'';state.currentPrincipleId=state.principles.items[0]?.id||'';refreshAll();return {ok:true,report};
}
function completeBundlePayload(){const pair=normalizePrincipleCardBundle({principles:state.principles,synthesisPresets:state.synthesisPresets});return {prepContentBundleVersion:1,format:'pmp-content-prep-complete-bundle-v1',generatedBy:`PMP Content Prep Studio v${VERSION}`,generatedAt:nowIso(),exportManifest:{creator:{...currentIdentitySnapshot()},lastBatchId:prepRuntime.lastBatchId||'',applicationVersion:VERSION},questionBank:exportableBank(),principles:pair.principles,synthesisPresets:pair.synthesisPresets,tagConfig:exportTagConfig(),subjectFacetRegistry:clone(state.subjectFacetRegistry),recallLibrary:clone(state.recallLibrary),knowledgeTree:state.knowledgeTree?{taxonomy:{id:state.knowledgeTree.id,subjectId:state.knowledgeTree.subjectId,name:{zh:state.knowledgeTree.name},version:state.knowledgeTree.version,status:state.knowledgeTree.status||'draft',nodes:clone(state.knowledgeTree.nodes)}}:null,recallLibraryReference:{schemaVersion:state.recallLibrary.schemaVersion,nodeCount:state.recallLibrary.nodes.length,edgeCount:state.recallLibrary.edges.length},knowledgeTreeReference:state.knowledgeTree?{id:state.knowledgeTree.id,subjectId:state.knowledgeTree.subjectId,name:state.knowledgeTree.name,version:state.knowledgeTree.version,nodeCount:state.knowledgeTree.nodes.length}:null}}

function recallIndex(){
  const byId=new Map(),terms=new Map();
  state.recallLibrary.nodes.forEach(n=>{
    byId.set(n.id,n);
    [n.title,n.titleEn,...(n.aliases||[])].map(x=>String(x||'').trim()).filter(Boolean).forEach(term=>{
      if(!terms.has(term))terms.set(term,[]);
      const rows=terms.get(term);
      if(!rows.some(item=>item.id===n.id))rows.push(n);
    });
  });
  return {byId,terms};
}
function resolveRecall(term){
  const idx=recallIndex(),list=idx.terms.get(String(term||'').trim())||[];
  return {matches:list,unique:list.length===1?list[0]:null};
}
function recallSuggestions(term){
  term=String(term||'').trim();if(!term)return [];
  const scored=[];
  state.recallLibrary.nodes.forEach(n=>{
    const hay=[n.title,n.titleEn,...(n.aliases||[])].join(' ');
    let score=0;
    if(hay.includes(term))score+=3;
    if(term.includes(n.title)&&n.title.length>=2)score+=2;
    if(score)scored.push({n,score});
  });
  return scored.sort((a,b)=>b.score-a.score||b.n.priority-a.n.priority).slice(0,5).map(x=>x.n);
}
function currentQuestion(){return state.questionBank.questions.find(q=>q.id===state.currentQuestionId)||null}
function currentRecall(){return state.recallLibrary.nodes.find(n=>n.id===state.currentRecallId)||null}
