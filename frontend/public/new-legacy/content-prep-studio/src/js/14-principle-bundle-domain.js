/*
 * P4.5.29 差异 6–8：原则包双格式兼容、旧库迁移与安全合并（纯领域函数，无 DOM）。
 *
 * - canonicalPrincipleDomain(payload)：识别 kg-principle-card-bundle-v1 / pmp-principle-preset-bundle-v1
 *   / 旧原则库 JSON / 旧归纳卡 JSON，统一归一为同一 Principle Domain；未知 format 明确报错。
 * - planPrincipleMerge(incoming, existing)：生成 Added / Unchanged / Conflict 合并计划。
 *   冲突分类：same-id-different-name / same-normalized-name-different-id / preset-rebind。
 * - applyPrincipleMergePlan(plan, existing)：默认只应用 Added（不覆盖、不删除已有原则或归纳卡）；
 *   冲突项必须带显式 resolution（take-incoming / keep-existing）才会覆盖。
 */

function normalizePrincipleNameKey(name){
  return String(name||'').trim().toLowerCase().replace(/[\s　]+/g,'');
}

function canonicalPrincipleDomain(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('原则与归纳卡文件必须是 JSON 对象');
  const format=String(payload.format||'').trim();
  const isPmpBundle=format==='pmp-principle-preset-bundle-v1'||(!format&&(Array.isArray(payload.principles)||Array.isArray(payload.presets)));
  const isKgBundle=format==='kg-principle-card-bundle-v1'||(!format&&(Array.isArray(payload?.principles?.items)||Array.isArray(payload?.synthesisPresets?.items)));
  if(format&&!isPmpBundle&&!isKgBundle)throw new Error('不支持的原则与归纳卡文件格式：'+format);
  if(isPmpBundle||isKgBundle){
    // 组合包保持一原则一归纳卡配对契约（与服务器 validate_principle_card_bundle 一致）
    const pair=normalizePrincipleCardBundle(payload);
    return {kind:isKgBundle?'kg-principle-card-bundle-v1':'pmp-principle-preset-bundle-v1',principles:pair.principles,synthesisPresets:pair.synthesisPresets};
  }
  // 旧原则库 / 旧归纳卡 JSON 单独导入：允许单边，归一到同一 Principle Domain
  const items=Array.isArray(payload.items)?payload.items:null;
  if(!items)throw new Error('不是支持的原则与归纳卡文件格式：缺少 principles/presets/items');
  const hasPresetRef=items.some(item=>item&&typeof item==='object'&&String(item.principleId||'').trim()!=='');
  if(hasPresetRef){
    return {kind:'legacy-synthesis-presets',principles:normalizePrinciples({}),synthesisPresets:normalizePresets({items})};
  }
  return {kind:'legacy-principle-library',principles:normalizePrinciples({items}),synthesisPresets:normalizePresets({})};
}

function planPrincipleMerge(incoming,existing){
  const incomingPrinciples=(incoming?.principles?.items||[]).filter(Boolean);
  const incomingPresets=(incoming?.synthesisPresets?.items||[]).filter(Boolean);
  const existingPrinciples=(existing?.principles?.items||[]).filter(Boolean);
  const existingPresets=(existing?.synthesisPresets?.items||[]).filter(Boolean);
  const byId=new Map(existingPrinciples.map(p=>[String(p.id),p]));
  const byName=new Map();
  existingPrinciples.forEach(p=>{
    const key=normalizePrincipleNameKey(p.name);
    if(key&&!byName.has(key))byName.set(key,p);
  });
  const presetById=new Map(existingPresets.map(s=>[String(s.id),s]));
  const added=[],unchanged=[],conflicts=[];
  incomingPrinciples.forEach(item=>{
    const id=String(item.id),name=String(item.name||'');
    const current=byId.get(id);
    if(!current){
      const nameOwner=byName.get(normalizePrincipleNameKey(name));
      if(nameOwner&&String(nameOwner.id)!==id){
        conflicts.push({type:'same-normalized-name-different-id',principleId:id,existingId:String(nameOwner.id),name:String(nameOwner.name),incomingName:name});
      }else{
        added.push(item);
      }
      return;
    }
    if(normalizePrincipleNameKey(current.name)!==normalizePrincipleNameKey(name)){
      conflicts.push({type:'same-id-different-name',principleId:id,existingId:String(current.id),existingName:String(current.name),incomingName:name});
    }else{
      unchanged.push(item);
    }
  });
  incomingPresets.forEach(preset=>{
    const id=String(preset.id||'');
    const current=id?presetById.get(id):null;
    if(current&&String(current.principleId)!==String(preset.principleId)){
      conflicts.push({type:'preset-rebind',presetId:id,principleId:String(preset.principleId),existingPresetId:String(current.id),existingPrincipleId:String(current.principleId),incomingPrincipleId:String(preset.principleId)});
    }
  });
  return {added,unchanged,conflicts,incomingPrinciples,incomingPresets};
}

function applyPrincipleMergePlan(plan,existing){
  const principles=[...(existing?.principles?.items||[]).filter(Boolean)];
  const presets=[...(existing?.synthesisPresets?.items||[]).filter(Boolean)];
  const takePrincipleIds=new Set();
  (plan?.added||[]).forEach(item=>{takePrincipleIds.add(String(item.id));principles.push(item)});
  (plan?.conflicts||[]).forEach(conflict=>{
    if(conflict.resolution!=='take-incoming')return;
    if(conflict.type==='same-id-different-name'){
      const index=principles.findIndex(p=>String(p.id)===String(conflict.principleId));
      const incoming=(plan?.incomingPrinciples||[]).find(p=>String(p.id)===String(conflict.principleId));
      if(index>=0&&incoming)principles[index]=incoming;
      takePrincipleIds.add(String(conflict.principleId));
    }
  });
  // take-incoming / added 原则的归纳卡随原则合入（替换同 principleId 或同 id 的旧卡）
  const incomingPresets=(plan?.incomingPresets||[]).filter(Boolean);
  incomingPresets.forEach(preset=>{
    if(!takePrincipleIds.has(String(preset.principleId)))return;
    const index=presets.findIndex(s=>String(s.id)===String(preset.id)||String(s.principleId)===String(preset.principleId));
    if(index>=0)presets[index]=preset;else presets.push(preset);
  });
  const now=Date.now();
  return {principles:{schemaVersion:1,items:principles,updatedAt:now},synthesisPresets:{schemaVersion:1,items:presets,updatedAt:now}};
}
