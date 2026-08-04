'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'V9.0_P3.1.1_DATA_INTEGRITY.json'),'utf8'));
function assert(condition,message){if(!condition)throw new Error(message)}
assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)$/.test(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()),'当前版本应保持在 V9.0-P3.3 兼容开发线');
assert(manifest.release==='v9.0-p3.1.1','P3.1.1 历史发布清单版本号不正确');
assert(manifest.baseline==='v9.0-p2.2','开发基线必须为 V9.0-P2.2');
assert(manifest.constraints?.adminPrimaryNavigationCount===8,'后台一级导航应为 8 项');
assert(manifest.constraints?.subjectAndKnowledgeTreeUnified===true,'科目与知识树必须进入统一模块');
assert(manifest.constraints?.taxonomyLifecycleMovedToHistory===true,'版本生命周期必须移入历史版本');
assert(manifest.constraints?.technicalDiagnosticsMovedToSettings===true,'技术诊断必须移出首页');
assert(manifest.constraints?.p22SafeDeletionPreserved===true,'P2.2 安全删除必须保留');
// 历史清单的文件哈希仅对应 P3.1.1 发布时刻；当前版本由 P3.2 清单校验。
console.log('v90-p311-historical-integrity-ok');
