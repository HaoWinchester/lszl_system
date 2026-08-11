'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const ROOT=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.resolve(ROOT,file),'utf8');
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

const CURRENT_PAGES=[
  'admin-console.html','admin-operations.html','admin-settings.html',
  'admin-subjects.html','feedback-management.html','message-management.html',
  'user-management.html','system-settings.html','practice-mode.html',
];
const TYPOGRAPHY_HREF='styles/focus-vega-typography.css';
const ADMIN_CORE_SCRIPTS=[
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
const EXPECTED_SCRIPT_SRCS={
  'admin-console.html':[
    ...ADMIN_CORE_SCRIPTS,'src/admin/50-admin-shell-app.js','src/108-admin-ui-icons.js',
  ],
  'admin-operations.html':[
    ...ADMIN_CORE_SCRIPTS,'src/admin/52-admin-operations-app.js',
    'src/admin/resizable-region.js','src/108-admin-ui-icons.js',
  ],
  'admin-settings.html':[
    ...ADMIN_CORE_SCRIPTS,'src/admin/53-admin-settings-app.js','src/108-admin-ui-icons.js',
  ],
  'admin-subjects.html':[
    ...ADMIN_CORE_SCRIPTS,'src/95-recall-association-library.js',
    'src/admin/51-admin-subjects-app.js','src/admin/53-recall-association-management.js',
    'src/admin/resizable-region.js','src/admin/module-help-content.js',
    'src/admin/module-help-controller.js',
    'src/99-workspace-placement.js','src/108-admin-ui-icons.js',
  ],
  'feedback-management.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/33-user-center.js','src/34-role-permissions.js',
    'src/101-engagement-repository.js','src/admin/49-admin-ui.js',
    'src/105-feedback-management-app.js','src/admin/resizable-region.js',
    'src/108-admin-ui-icons.js',
  ],
  'message-management.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/33-user-center.js','src/34-role-permissions.js',
    'src/101-engagement-repository.js','src/admin/49-admin-ui.js',
    'src/106-message-management-app.js','src/admin/resizable-region.js',
    'src/108-admin-ui-icons.js',
  ],
  'user-management.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/33-user-center.js','src/39-global-shortcuts.js',
    'src/35-user-management-service.js','src/35-user-management.js',
    'src/admin/48-admin-context-nav.js','src/admin/resizable-region.js',
    'src/108-admin-ui-icons.js',
  ],
  'system-settings.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/34-role-permissions.js','src/37-subscription-plans.js',
    'src/37-subscription-orders.js','src/37-subscription-redeem-codes.js',
    'src/37-subscription-core.js','src/31-admin-utils.js','src/32-wechat-login.js',
    'src/33-user-center.js','src/39-global-shortcuts.js','src/36-system-settings.js',
    'src/admin/48-admin-context-nav.js','src/admin/resizable-region.js',
    'src/108-admin-ui-icons.js',
  ],
  'practice-mode.html':[
    'src/01-runtime-config.js','src/28-app-storage.js','src/29-auth-core.js',
    'src/30-shared-auth-dialog.js','src/32-wechat-login.js','src/34-role-permissions.js',
    'src/37-subscription-plans.js','src/37-subscription-orders.js',
    'src/37-subscription-redeem-codes.js','src/37-subscription-core.js',
    'src/33-user-center.js','src/107-learning-ui-icons.js','src/41-account-menu.js',
    'src/101-engagement-repository.js','src/103-support-center.js',
    'src/59a-paper-learning-modes.js','src/58-paper-access-service.js',
    'src/59-published-paper-repository.js','src/100-practice-mode.js',
  ],
};
const EXPECTED_TOKENS={
  '--ui-font-sans':'"PingFang SC","Microsoft YaHei",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  '--ui-text-meta':'.75rem',
  '--ui-text-control':'.875rem',
  '--ui-text-body':'1rem',
  '--ui-text-card-title':'1.125rem',
  '--ui-text-section-title':'1.25rem',
  '--ui-text-shell-title':'1.5rem',
  '--ui-text-page-title':'1.75rem',
  '--ui-text-kpi':'1.5rem',
  '--ui-text-kpi-lg':'1.75rem',
  '--ui-weight-regular':'400',
  '--ui-weight-medium':'500',
  '--ui-weight-semibold':'600',
  '--ui-weight-bold':'700',
  '--ui-leading-control':'1.35',
  '--ui-leading-heading':'1.24',
  '--ui-leading-body':'1.65',
};

function tagAttribute(tag,name){
  return new RegExp(`\\b${name}=["']([^"']+)["']`,'i').exec(tag)?.[1]||'';
}

function stylesheetHrefs(html){
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match=>match[0])
    .filter(tag=>tagAttribute(tag,'rel').toLowerCase()==='stylesheet')
    .map(tag=>tagAttribute(tag,'href'))
    .filter(Boolean);
}

function scriptSrcs(html){
  return [...html.matchAll(/<script\b[^>]*>/gi)]
    .map(match=>tagAttribute(match[0],'src'))
    .filter(Boolean);
}

function parseTypographyRule(css){
  const clean=css.replace(/\/\*[\s\S]*?\*\//g,'').trim();
  const approvedRule=/^:where\(\s*body\[data-ui-skin="focus-vega"\]\s*,\s*body\[data-admin-skin="focus-vega"\]\s*,\s*body\[data-learning-skin="focus-vega"\]\s*\)\s*\{([^{}]*)\}$/;
  const match=approvedRule.exec(clean);
  assert.ok(match,'typography CSS must contain only the approved :where opt-in rule');

  const declarations=match[1].split(';').map(value=>value.trim()).filter(Boolean);
  const tokens={};
  for(const declaration of declarations){
    const parts=/^(--[a-z0-9-]+)\s*:\s*(.+)$/i.exec(declaration);
    assert.ok(parts,`typography rule must contain only CSS variable declarations: ${declaration}`);
    assert.equal(Object.hasOwn(tokens,parts[1]),false,`duplicate typography token: ${parts[1]}`);
    tokens[parts[1]]=parts[2].trim();
  }
  return tokens;
}

test('current Focus Vega pages load typography immediately before their skin adapter',()=>{
  for(const page of CURRENT_PAGES){
    const hrefs=stylesheetHrefs(source(page));
    const adapter=page==='practice-mode.html'
      ?'styles/learning-skin.css'
      :'styles/admin-focus-vega.css';
    assert.equal(hrefs.filter(href=>href===TYPOGRAPHY_HREF).length,1,`${page}: typography link count`);
    const adapterIndex=hrefs.indexOf(adapter);
    assert.notEqual(adapterIndex,-1,`${page}: missing ${adapter}`);
    assert.equal(hrefs[adapterIndex-1],TYPOGRAPHY_HREF,`${page}: typography must immediately precede ${adapter}`);
  }
  assert.doesNotMatch(source('index.html'),/focus-vega-typography|data-ui-skin/);
});

test('current Focus Vega pages preserve their exact business script order',()=>{
  for(const page of CURRENT_PAGES){
    const actual=scriptSrcs(source(page));
    assert.deepEqual(actual,EXPECTED_SCRIPT_SRCS[page],`${page}: script src sequence changed`);
  }
});

test('the complete fixed typography token contract is exact',()=>{
  const css=source('styles/focus-vega-typography.css');
  const tokens=parseTypographyRule(css);
  assert.deepEqual(tokens,EXPECTED_TOKENS);

  const approvedWeights=new Set(['400','500','600','700']);
  for(const [property,value] of Object.entries(tokens)){
    if(property.startsWith('--ui-weight-')){
      assert.ok(approvedWeights.has(value),`${property}: unsupported weight ${value}`);
    }
  }
  assert.doesNotMatch(css,/(^|[;{])\s*font-weight\s*:/im,'token-only stylesheet must not declare font-weight properties');
});

test('the token-only opt-in rule does not target frozen descendants',()=>{
  const css=source('styles/focus-vega-typography.css');
  parseTypographyRule(css);
  for(const frozen of [
    '#authModal','.account-menu','.subscription-','.membership-','.payment-',
    '.wechat-pay-','.qt-canvas-shell','.qw-canvas-shell','.kr-viewport',
  ])assert.doesNotMatch(css,new RegExp(escapeRegExp(frozen)),frozen);
});
