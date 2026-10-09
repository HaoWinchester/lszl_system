'use strict';

/* 学习画布共享主题控制器：深度回忆与多题归纳共用同一 localStorage key，
 * 任一页切换主题后另一页（含跨标签页）跟随。页面控件绑定由各页自行完成。 */
(function(global){
  const KEY='kg_deep_recall_theme_v1';
  const MIGRATION_KEY='kg_deep_recall_theme_platform_migrated_v1';
  const THEMES=new Set(['platform','parchment','aurora','neon','sakura','ocean','latte']);
  const Store=global.KGAppStorage||{};
  function readRaw(key){
    try{return Store.readString?Store.readString(key,''):(global.localStorage?.getItem(key)||'')}catch(e){return ''}
  }
  function writeRaw(key,value){
    try{if(Store.writeString)Store.writeString(key,value);else global.localStorage?.setItem(key,value)}catch(e){/* 存储不可用时仅失去持久化 */}
  }
  function create(options={}){
    const roots=()=>[].concat(typeof options.roots==='function'?options.roots():options.roots||[]).filter(Boolean);
    // 一次性迁移：旧默认 parchment 统一升级为 platform，之后按存储值走。
    function saved(){
      const raw=readRaw(KEY);
      const migrated=readRaw(MIGRATION_KEY)==='1';
      if(!migrated&&(!raw||raw==='parchment')){
        writeRaw(MIGRATION_KEY,'1');writeRaw(KEY,'platform');
        return 'platform';
      }
      return THEMES.has(raw)?raw:'platform';
    }
    function apply(theme){
      const next=THEMES.has(theme)?theme:'platform';
      for(const el of roots())el.dataset.theme=next;
      document.body.dataset.krTheme=next;
      writeRaw(KEY,next);
      global.dispatchEvent(new CustomEvent('kg:deep-recall-theme-change',{detail:{theme:next}}));
      return next;
    }
    return {init:()=>apply(saved()),apply,saved,THEMES};
  }
  global.KGLearningTheme=Object.freeze({create,THEMES});
})(window);
