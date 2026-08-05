'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const adapter='src/108-admin-ui-icons.js';
const families={
  common:[
    'admin-console.html',
    'admin-operations.html',
    'admin-settings.html',
    'admin-subjects.html',
    'feedback-management.html',
    'message-management.html',
  ],
  users:['user-management.html'],
  settings:['system-settings.html'],
};
const pages=Object.values(families).flat();
const skinFiles=[
  'styles/admin-focus-vega.css',
  'styles/admin-focus-vega-common.css',
  'styles/admin-focus-vega-users.css',
  'styles/admin-focus-vega-settings.css',
];
const commonAdminScripts=[
  'src/28-app-storage.js','src/29-auth-core.js','src/33-user-center.js',
  'src/86-activity-schema-v1.js','src/87-guided-learning-data.js',
  'src/91-learning-content-core.js','src/93-content-organization-core.js',
  'src/admin/00-admin-core.js','src/admin/10-content-repository.js',
  'src/admin/11-local-content-repository.js','src/admin/20-admin-permission-service.js',
  'src/admin/21-admin-audit-service.js','src/admin/22-admin-transaction-service.js',
  'src/admin/30-reference-index-service.js','src/admin/31-subject-service.js',
  'src/admin/32-taxonomy-service.js','src/admin/33-activity-service.js',
  'src/admin/34-course-service.js','src/admin/35-release-service.js',
  'src/admin/40-admin-service-registry.js','src/admin/41-learning-content-compat.js',
  'src/admin/49-admin-ui.js',
];
const engagementScripts=[
  'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
  'src/33-user-center.js','src/34-role-permissions.js',
  'src/101-engagement-repository.js','src/admin/49-admin-ui.js',
];
const existingScripts={
  'admin-console.html':[...commonAdminScripts,'src/admin/50-admin-shell-app.js'],
  'admin-operations.html':[...commonAdminScripts,'src/admin/52-admin-operations-app.js'],
  'admin-settings.html':[...commonAdminScripts,'src/admin/53-admin-settings-app.js'],
  'admin-subjects.html':[
    ...commonAdminScripts,
    'src/95-recall-association-library.js',
    'src/admin/51-admin-subjects-app.js',
    'src/admin/53-recall-association-management.js',
    'src/99-workspace-placement.js',
  ],
  'feedback-management.html':[...engagementScripts,'src/105-feedback-management-app.js'],
  'message-management.html':[...engagementScripts,'src/106-message-management-app.js'],
  'user-management.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/33-user-center.js','src/39-global-shortcuts.js',
    'src/35-user-management-service.js','src/35-user-management.js',
    'src/admin/48-admin-context-nav.js',
  ],
  'system-settings.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/31-admin-utils.js','src/32-wechat-login.js',
    'src/33-user-center.js','src/39-global-shortcuts.js','src/36-system-settings.js',
    'src/admin/48-admin-context-nav.js',
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

function splitSelectorList(prelude){
  const result=[];
  let start=0,round=0,square=0;
  for(let index=0;index<prelude.length;index+=1){
    const char=prelude[index];
    if(char==='(')round+=1;
    else if(char===')')round-=1;
    else if(char==='[')square+=1;
    else if(char===']')square-=1;
    else if(char===','&&round===0&&square===0){result.push(prelude.slice(start,index).trim());start=index+1;}
  }
  result.push(prelude.slice(start).trim());
  return result.filter(Boolean);
}

function assertScoped(source,file){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'');
  function walk(block){
    let cursor=0;
    while(cursor<block.length){
      while(/\s/.test(block[cursor]||''))cursor+=1;
      if(cursor>=block.length)return;
      const open=block.indexOf('{',cursor);
      assert.notEqual(open,-1,`${file}: missing CSS block`);
      const prelude=block.slice(cursor,open).trim();
      let depth=1,close=open+1;
      while(close<block.length&&depth){
        if(block[close]==='{')depth+=1;
        else if(block[close]==='}')depth-=1;
        close+=1;
      }
      assert.equal(depth,0,`${file}: unbalanced CSS block ${prelude}`);
      const body=block.slice(open+1,close-1);
      if(prelude.startsWith('@')){
        assert.match(prelude,/^@media\b/,`${file}: unsupported at-rule ${prelude}`);
        assert.ok(
          /prefers-reduced-motion/.test(prelude)||/min-width\s*:\s*901px/.test(prelude),
          `${file}: mobile rule is outside scope ${prelude}`,
        );
        walk(body);
      }else{
        for(const selector of splitSelectorList(prelude)){
          assert.ok(
            selector.startsWith('body[data-admin-skin="focus-vega"]'),
            `${file}: unscoped selector ${selector}`,
          );
        }
        assert.equal(body.includes('{'),false,`${file}: nested declaration ${prelude}`);
      }
      cursor=close;
    }
  }
  walk(clean);
}

test('all eight pages opt in without changing business script order',()=>{
  for(const file of pages){
    const html=read(file);
    assert.match(html,/<body\b[^>]*data-admin-skin=["']focus-vega["']/i,file);
    assert.deepEqual(
      scriptSrcs(html).filter(src=>src!==adapter),
      existingScripts[file],
      `${file}: existing business scripts changed`,
    );
    assert.equal(scriptSrcs(html).filter(src=>src===adapter).length,1,`${file}: visual adapter`);
  }
});

for(const [family,files] of Object.entries(families)){
  test(`${family} pages load the shared skin and final family adapter`,()=>{
    for(const file of files){
      const hrefs=stylesheetHrefs(read(file));
      assert.equal(hrefs.at(-2),'styles/admin-focus-vega.css',file);
      assert.equal(hrefs.at(-1),`styles/admin-focus-vega-${family}.css`,file);
    }
  });
}

test('new skin styles are scoped, PC-only, local, and avoid frozen surfaces',()=>{
  const forbidden=[
    '#authModal','.auth-backdrop','.auth-modal',
    '.admin-account-trigger','.admin-account-popover',
    '.subscription-','.membership-','.payment-','.wechat-pay-',
  ];
  for(const file of skinFiles){
    const css=read(file);
    assert.doesNotMatch(css,/:root\b|https?:\/\/|@import/,file);
    for(const token of forbidden)assert.equal(css.includes(token),false,`${file}: frozen ${token}`);
    assertScoped(css,file);
  }
});

test('shared tokens and family geometry use the approved Focus Vega contract',()=>{
  const shared=read('styles/admin-focus-vega.css');
  const common=read('styles/admin-focus-vega-common.css');
  const users=read('styles/admin-focus-vega-users.css');
  const settings=read('styles/admin-focus-vega-settings.css');
  for(const token of [
    '--admin-background:#fafafa','--admin-foreground:#18181b',
    '--admin-primary:#6d5dfc','--admin-border:#e4e4e7',
    '--admin-radius-control:8px','--admin-radius-panel:10px',
  ])assert.ok(shared.replace(/\s+/g,'').includes(token),token);
  for(const selector of ['.admin-main','.admin-page-head','.engagement-admin-grid'])assert.ok(common.includes(selector),selector);
  for(const selector of ['.um-app','.um-layout','.um-topbar'])assert.ok(users.includes(selector),selector);
  for(const selector of ['.ss-app','.ss-layout','.ss-sidebar'])assert.ok(settings.includes(selector),selector);
});

test('admin icons are local, whitelisted, and have an accessible fallback',()=>{
  const source=read('src/108-admin-ui-icons.js');
  const sprite=read('assets/icons/lucide-admin.svg');
  assert.match(source,/global\.KGAdminIcons=Object\.freeze/);
  assert.match(source,/unknown:\s*['"]circle-help['"]/);
  assert.match(source,/aria-hidden/);
  assert.match(source,/aria-label/);
  assert.doesNotMatch(source,/fetch\(|https?:\/\//);
  for(const name of [
    'plus','refresh-cw','search','settings','arrow-left',
    'download','upload','trash-2','circle-help',
  ])assert.match(sprite,new RegExp(`<symbol\\s+id=["']${name}["']`),name);
});

console.log('admin-focus-vega-skin-contract-ok');
