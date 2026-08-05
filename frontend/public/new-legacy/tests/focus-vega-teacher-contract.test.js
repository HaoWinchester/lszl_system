'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const pages=[
  'teacher-workbench.html',
  'question-bank.html',
  'paper-management.html',
  'course-admin.html',
  'content-center.html',
];
const iconAdapter='src/109-focus-vega-ui-icons.js';
const anchors={
  'teacher-workbench.html':['tw-topbar','tw-workflow','tw-tabs'],
  'question-bank.html':['qb-app','qb-layout','qb-editor','qb-inspector'],
  'paper-management.html':['qb-app','paper-list','pm-paper-library-layout','pm-question-workbench'],
  'course-admin.html':['ca-app','ca-layout','ca-tree','ca-node-editor'],
  'content-center.html':['cc-app','cc-layout','cc-tree-panel','cc-inspector'],
};
const inlineScriptHashes={
  'teacher-workbench.html':[],
  'question-bank.html':[],
  'paper-management.html':[],
  'course-admin.html':['619250ef4a795ae71c1a2af4a6cae38104fea03f1b12c439d7edd3094c2f821c'],
  'content-center.html':['93b597957350ba2c1f1241464267c56cffbd31d1d3ac9b71a19411f4992ec682'],
};
const existingScripts={
  'teacher-workbench.html':[
    'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js',
    'src/87-guided-learning-data.js','src/91-learning-content-core.js',
    'src/93-content-organization-core.js','src/admin/00-admin-core.js',
    'src/admin/10-content-repository.js','src/admin/11-local-content-repository.js',
    'src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js',
    'src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js',
    'src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js',
    'src/admin/33-activity-service.js','src/admin/34-course-service.js',
    'src/admin/35-release-service.js','src/admin/40-admin-service-registry.js',
    'src/admin/41-learning-content-compat.js','src/admin/48-admin-context-nav.js',
    'src/91-teacher-workbench-app.js',
  ],
  'question-bank.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/33-user-center.js','src/39-global-shortcuts.js',
    'src/50-question-data.js','src/91-learning-content-core.js',
    'src/95-recall-association-library.js','question-studio/question-studio-parser.js',
    'src/98-teacher-workflow-p2-services.js','src/65-question-bank-admin.js',
    'src/98-question-classification.js','src/97-teacher-question-workflow.js',
    'src/admin/48-admin-context-nav.js','src/99-workspace-placement.js',
  ],
  'paper-management.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/33-user-center.js','src/50-question-data.js',
    'src/91-learning-content-core.js','src/95-recall-association-library.js',
    'src/98-teacher-workflow-p2-services.js','src/98-question-classification.js',
    'src/65-question-bank-admin.js','src/admin/48-admin-context-nav.js',
  ],
  'course-admin.html':[
    'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js',
    'src/87-guided-learning-data.js','src/91-learning-content-core.js',
    'src/65-canvas-workspace-store.js','src/93-content-organization-core.js',
    'src/admin/00-admin-core.js','src/admin/10-content-repository.js',
    'src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js',
    'src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js',
    'src/admin/30-reference-index-service.js','src/admin/31-subject-service.js',
    'src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js',
    'src/admin/34-course-service.js','src/admin/35-release-service.js',
    'src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js',
    'src/98-teacher-workflow-p2-services.js','src/91-course-admin-app.js',
    'src/93-assessment-config-app.js','src/92-workspace-panel-manager.js',
    'src/97-teacher-course-workflow.js','src/admin/48-admin-context-nav.js',
  ],
  'content-center.html':[
    'src/28-app-storage.js','src/29-auth-core.js','src/86-activity-schema-v1.js',
    'src/87-guided-learning-data.js','src/91-learning-content-core.js',
    'src/93-content-organization-core.js','src/admin/00-admin-core.js',
    'src/admin/10-content-repository.js','src/admin/11-local-content-repository.js',
    'src/admin/20-admin-permission-service.js','src/admin/21-admin-audit-service.js',
    'src/admin/22-admin-transaction-service.js','src/admin/30-reference-index-service.js',
    'src/admin/31-subject-service.js','src/admin/32-taxonomy-service.js',
    'src/admin/33-activity-service.js','src/admin/34-course-service.js',
    'src/admin/35-release-service.js','src/admin/40-admin-service-registry.js',
    'src/admin/41-learning-content-compat.js','src/91-knowledge-tree-index.js',
    'src/97-knowledge-question-stats.js','src/91-content-center-app.js',
    'src/93-content-organization-app.js','src/92-workspace-panel-manager.js',
    'src/99-embedded-workspace.js',
  ],
};

function stylesheetHrefs(html){
  return [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)]
    .map(match=>/\bhref=["']([^"']+)["']/i.exec(match[0])?.[1])
    .filter(Boolean);
}

function scriptSrcs(html){
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi)]
    .map(match=>match[1]);
}

function inlineScriptDigests(html){
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match=>crypto.createHash('sha256').update(match[1]).digest('hex'));
}

function classTokenCount(html,className){
  return [...html.matchAll(/\bclass=["']([^"']+)["']/gi)]
    .filter(match=>match[1].split(/\s+/).includes(className)).length;
}

function splitSelectorList(prelude){
  const result=[];
  let start=0,round=0,square=0;
  for(let index=0;index<prelude.length;index+=1){
    const char=prelude[index];
    if(char==='(')round+=1;
    else if(char===')')round-=1;
    else if(char==='[')square+=1;
    else if(char===']')square-=1;
    else if(char===','&&round===0&&square===0){
      result.push(prelude.slice(start,index).trim());
      start=index+1;
    }
  }
  result.push(prelude.slice(start).trim());
  return result.filter(Boolean);
}

function assertScopedPcCss(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'');
  function walk(block,insidePcMedia=false){
    let cursor=0;
    while(cursor<block.length){
      while(/\s/.test(block[cursor]||''))cursor+=1;
      if(cursor>=block.length)return;
      const open=block.indexOf('{',cursor);
      assert.notEqual(open,-1,'missing CSS block');
      const prelude=block.slice(cursor,open).trim();
      let depth=1,close=open+1;
      while(close<block.length&&depth){
        if(block[close]==='{')depth+=1;
        else if(block[close]==='}')depth-=1;
        close+=1;
      }
      assert.equal(depth,0,`unbalanced CSS block ${prelude}`);
      const body=block.slice(open+1,close-1);
      if(prelude.startsWith('@')){
        const media=prelude.match(/^@media\s*\(min-width\s*:\s*(\d+)px\)$/);
        assert.ok(media,`unsupported responsive rule: ${prelude}`);
        assert.ok(Number(media[1])>=901,`mobile rule is outside the approved PC scope: ${prelude}`);
        walk(body,true);
      }else{
        assert.equal(insidePcMedia,true,`selector outside PC scope: ${prelude}`);
        for(const selector of splitSelectorList(prelude)){
          assert.match(selector,/^body\[data-ui-skin=["']focus-vega["']\]/,`unscoped: ${selector}`);
        }
        assert.equal(body.includes('{'),false,`nested declaration: ${prelude}`);
      }
      cursor=close;
    }
  }
  walk(clean);
}

test('five teacher pages opt into the shared typography and final family adapter',()=>{
  for(const file of pages){
    const html=read(file);
    assert.match(html,/<body\b[^>]*data-ui-skin=["']focus-vega["']/i,file);
    assert.deepEqual(
      stylesheetHrefs(html).slice(-2),
      ['styles/focus-vega-typography.css','styles/focus-vega-teacher.css'],
      `${file}: final stylesheet order`,
    );
  }
});

test('teacher opt-in preserves exact business script order and native layout anchors',()=>{
  for(const file of pages){
    const html=read(file);
    assert.deepEqual(
      scriptSrcs(html).filter(source=>source!==iconAdapter),
      existingScripts[file],
      `${file}: business scripts changed`,
    );
    assert.equal(scriptSrcs(html).filter(source=>source===iconAdapter).length,1,`${file}: icon adapter count`);
    assert.equal(scriptSrcs(html).at(-1),iconAdapter,`${file}: icon adapter must load last`);
    assert.deepEqual(inlineScriptDigests(html),inlineScriptHashes[file],`${file}: inline behavior changed`);
    for(const anchor of anchors[file]){
      assert.equal(classTokenCount(html,anchor),1,`${file}: expected one native .${anchor}`);
    }
  }
});

test('teacher adapter is local, PC-only, scoped, and avoids frozen surfaces',()=>{
  const adapterPath=path.join(root,'styles/focus-vega-teacher.css');
  assert.equal(fs.existsSync(adapterPath),true,'missing styles/focus-vega-teacher.css');
  const css=fs.readFileSync(adapterPath,'utf8');
  assert.match(css,/@media\s*\(min-width\s*:\s*901px\)/);
  assert.doesNotMatch(css,/:root\b|https?:\/\/|@import/);
  assert.doesNotMatch(
    css,
    /#authModal|#authStatus|\.auth-(?:backdrop|modal)|\.account-menu|\.tw-user|#wbAccount|#ccAccount|#userCenterModal|\.user-center|\.uc-|#userSubscriptionDetailModal|\.kg-subscription-|\.subscription-|\.membership-|\.payment-|\.wechat(?:-pay)?-/,
  );
  assertScopedPcCss(css);
});

test('teacher product icons use one local allowlisted sprite with a safe fallback',()=>{
  const sourcePath=path.join(root,iconAdapter);
  const spritePath=path.join(root,'assets/icons/lucide-product.svg');
  assert.equal(fs.existsSync(sourcePath),true,`missing ${iconAdapter}`);
  assert.equal(fs.existsSync(spritePath),true,'missing assets/icons/lucide-product.svg');
  const source=fs.readFileSync(sourcePath,'utf8');
  const sprite=fs.readFileSync(spritePath,'utf8');
  assert.match(source,/global\.KGFocusVegaIcons=Object\.freeze/);
  assert.match(source,/unknown:\s*['"]circle-help['"]/);
  assert.match(source,/\[data-ui-icon\]:not\(\[data-ui-icon-ready\]\)/);
  assert.match(source,/closest\(protectedSelector\)/);
  assert.match(source,/aria-hidden/);
  assert.match(source,/\[class\^=["']wechat-["']\]/);
  assert.doesNotMatch(source,/fetch\(|https?:\/\//);
  assert.match(read('styles/focus-vega-teacher.css'),/\[data-ui-icon\]/);
  assert.match(sprite,/<svg\b[^>]*fill=["']none["'][^>]*stroke=["']currentColor["'][^>]*stroke-width=["']2["']/);
  for(const name of [
    'arrow-left','arrow-right','book-open','check','chevron-down','circle-help',
    'download','edit-3','filter','folder-tree','minus','plus','search','settings',
    'trash-2','upload','x',
  ])assert.match(sprite,new RegExp(`<symbol\\s+id=["']${name}["']`),name);
  for(const file of pages){
    assert.match(read(file),/data-ui-icon=["'][^"']+["']/,`${file}: declarative icon slot`);
  }
});

console.log('focus-vega-teacher-contract-ok');
