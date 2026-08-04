'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const manifestPath=path.join(root,'V9.0_P2.1_DATA_INTEGRITY.json');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p2.1'){console.log('v90-p21-data-integrity-skipped-for',currentVersion);process.exit(0)}
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function assert(condition,message){if(!condition)throw new Error(message)}
assert(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()==='v9.0-p2.1','版本号应为 v9.0-p2.1');
assert(manifest.release==='v9.0-p2.1','发布清单版本号不正确');
assert(manifest.constraints?.knowledgeTreeMaxDepth===9,'知识树最大层级应为 9');
assert(manifest.constraints?.taxonomyImportCreatesDraft===true,'导入应创建草稿版本');
assert(manifest.constraints?.taxonomyAdminPublishCurrent===true,'管理员发布当前版本能力应启用');
assert(manifest.constraints?.taxonomyPublishedReadOnly===true,'已发布版本应只读');
for(const [file,expected] of Object.entries(manifest.releaseFileSha256||{})){
  assert(fs.existsSync(path.join(root,file)),`${file} 不存在`);
  assert(fileHash(file)===expected,`${file} 与 V9.0-P2.1 发布清单不一致`);
}
console.log('v90-p21-data-integrity-ok',Object.keys(manifest.releaseFileSha256||{}).length);
