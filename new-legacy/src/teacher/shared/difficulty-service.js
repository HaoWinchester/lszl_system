'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const LEVELS=Object.freeze([
    Object.freeze({value:'easy',label:'简单',stars:1}),
    Object.freeze({value:'medium',label:'中等',stars:2}),
    Object.freeze({value:'hard',label:'困难',stars:3})
  ]);
  const LEGACY=Object.freeze({
    easy:'easy',simple:'easy','简单':'easy','基础':'easy','初级':'easy','1':'easy','★':'easy',
    medium:'medium','中等':'medium','中级':'medium','2':'medium','★★':'medium',
    hard:'hard','困难':'hard','难点':'hard','高级':'hard','3':'hard','★★★':'hard'
  });
  function normalize(value){return LEGACY[String(value??'').trim().toLowerCase()]||''}
  function info(value){const normalized=normalize(value);return LEVELS.find(item=>item.value===normalized)||Object.freeze({value:'',label:'未设置',stars:0})}
  function label(value){return info(value).label}
  function stars(value,{empty='☆☆☆',filled='★',unfilled='☆'}={}){const count=info(value).stars;if(!count)return empty;return filled.repeat(count)+unfilled.repeat(Math.max(0,3-count))}
  function migrateQuestion(question={}){
    const raw=String(question.difficulty||'').trim();
    const next=normalize(raw);
    const tags=[...new Set((Array.isArray(question.tags)?question.tags:[]).map(String).filter(Boolean))];
    if(raw==='重点'&&!tags.includes('重点'))tags.push('重点');
    if(raw==='易错点'&&!tags.includes('易错'))tags.push('易错');
    return {...question,difficulty:next,tags};
  }
  root.DifficultyService=Object.freeze({LEVELS,normalize,info,label,stars,migrateQuestion});
  global.KGDifficultyService=root.DifficultyService;
})(globalThis);
