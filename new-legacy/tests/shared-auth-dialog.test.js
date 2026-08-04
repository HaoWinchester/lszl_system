'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const targetPages=['index.html','practice-mode.html'];

for(const file of targetPages){
  const html=read(file);
  assert.match(html,/id="authDialogRoot"/,`${file} must expose the shared auth mount point`);
  assert.equal((html.match(/src="src\/30-shared-auth-dialog\.js"/g)||[]).length,1,`${file} must load the shared auth dialog once`);
  assert.equal((html.match(/id="authModal"/g)||[]).length,0,`${file} must not keep a copied auth dialog template`);
  assert.ok(html.indexOf('src/29-auth-core.js')<html.indexOf('src/30-shared-auth-dialog.js'),`${file} must load the auth core before the dialog`);
  assert.ok(html.indexOf('src/30-shared-auth-dialog.js')<html.indexOf('src/32-wechat-login.js'),`${file} must mount the dialog before WeChat enhancement`);
}

assert.doesNotMatch(read('practice-mode.html'),/30-standalone-auth-dialog\.js/,'practice mode must not bind a second auth implementation');
assert.doesNotMatch(read('styles/learning-skin.css'),/\.auth-modal/,'practice skin must not restyle the shared free-mode dialog');
assert.doesNotMatch(
  read('src/41-account-menu.js'),
  /openAuth\('登录后可以新增、编辑、连线和保存自己的图谱。'/,
  'the shared account menu must not inject a graph-only login reason',
);
assert.match(
  read('src/30-auth-guards.js'),
  /logout:window\.KGAuthRuntime\?\.logout/,
  'the graph must configure shared logout with its save-before-logout runtime handler',
);

const sharedPath=path.join(root,'src/30-shared-auth-dialog.js');
assert.ok(fs.existsSync(sharedPath),'the shared auth dialog controller must exist');
const shared=fs.readFileSync(sharedPath,'utf8');
for(const name of ['mount','configure','open','close','message','setBusy','login','register','logout','renderStatus','isLoggedIn','currentUsername']){
  assert.match(shared,new RegExp(`\\b${name}\\b`),`shared controller must expose ${name}`);
}

console.log('shared-auth-dialog-static-ok');
