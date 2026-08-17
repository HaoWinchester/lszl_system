#!/usr/bin/env node
/**
 * 优化数据加载性能补丁
 *
 * 问题：多题归纳、深度回忆、做题模式页面数据加载慢（2-5秒空白）
 * 原因：server-state-bootstrap + question-catalog-adapter + 业务初始化 串行阻塞
 * 方案：
 *   1. question-catalog-adapter.ready 改为 Promise.race([ready, timeout])
 *   2. 业务脚本不再 await catalog.ready，改为并行加载 + 乐观渲染
 *   3. catalog 加载完成后通过事件触发数据更新
 */

const fs = require('fs');
const path = require('path');

const PATCHES = [
  // 补丁1: 多题归纳 - 移除阻塞式 await，改为并行加载
  {
    file: 'new-legacy/src/77-multi-question-workspace.js',
    search: `  async function init(){
    if(state.initialized||state.initializing||!document.body.classList.contains('question-workspace-page'))return;
    state.initializing=true;
    try{await global.KGQuestionCatalogAdapter.ready}catch(error){state.initializing=false;document.body.dataset.questionCatalogUnavailable='true';notify('题目目录暂不可用，请稍后刷新重试。');return}`,
    replace: `  async function init(){
    if(state.initialized||state.initializing||!document.body.classList.contains('question-workspace-page'))return;
    state.initializing=true;
    // P4.5.38：不阻塞等待 catalog ready，先初始化 UI，catalog 完成后再填充数据（性能优化）
    const catalogPromise=global.KGQuestionCatalogAdapter?.ready||Promise.resolve();
    catalogPromise.catch(error=>{
      console.warn('题目目录加载失败，部分功能受限',error);
      document.body.dataset.questionCatalogUnavailable='true';
    });`,
  },

  // 补丁2: 做题模式 - 移除阻塞式 await
  {
    file: 'new-legacy/src/100-practice-mode.js',
    search: `  async function init(){
    cacheDom();dom.startButtons.forEach(button=>button.dataset.defaultLabel=button.textContent);bind();
    state.retiredNavigation=readRetiredModeNavigation();
    try{await global.KGQuestionCatalogAdapter.ready;state.catalogAvailable=true}catch(error){state.catalogAvailable=false;console.error(error)}
    syncLobby();showRetiredModeNotice();`,
    replace: `  async function init(){
    cacheDom();dom.startButtons.forEach(button=>button.dataset.defaultLabel=button.textContent);bind();
    state.retiredNavigation=readRetiredModeNavigation();
    // P4.5.38：不阻塞等待 catalog ready，先显示 UI，数据异步加载（性能优化）
    const catalogPromise=global.KGQuestionCatalogAdapter?.ready||Promise.resolve();
    catalogPromise.then(()=>{state.catalogAvailable=true;syncLobby()}).catch(error=>{state.catalogAvailable=false;console.warn('题目目录加载失败',error);syncLobby()});
    syncLobby();showRetiredModeNotice();`,
  },

  // 补丁3: 深度回忆 - 已经没有阻塞式 await，但可以优化 loadDatabaseSession
  {
    file: 'new-legacy/src/86-knowledge-recall.js',
    search: `      try{await window.KGQuestionCatalogAdapter?.ready}catch(error){}`,
    replace: `      // P4.5.38：不阻塞等待 catalog（题目数据独立加载）
      window.KGQuestionCatalogAdapter?.ready?.catch(()=>{});`,
  },
];

function applyPatches() {
  let applied = 0;
  let skipped = 0;

  for (const patch of PATCHES) {
    const filePath = path.join(__dirname, '..', patch.file);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  跳过: ${patch.file} (文件不存在)`);
      skipped++;
      continue;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    if (!content.includes(patch.search)) {
      console.log(`⚠️  跳过: ${patch.file} (未找到匹配内容，可能已应用或代码已变更)`);
      skipped++;
      continue;
    }

    content = content.replace(patch.search, patch.replace);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ 已应用: ${patch.file}`);
    applied++;
  }

  console.log(`\n📊 补丁应用完成: ${applied} 个成功, ${skipped} 个跳过`);

  if (applied > 0) {
    console.log(`\n📝 下一步: 运行 sync 并发布新版本`);
    console.log(`   cd frontend && node scripts/sync-new-legacy.js`);
    console.log(`   node scripts/manage-new-legacy.js update new-legacy --skip-browser`);
  }
}

applyPatches();
