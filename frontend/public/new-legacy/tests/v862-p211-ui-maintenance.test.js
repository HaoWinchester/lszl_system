'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function assert(condition,message){if(!condition)throw new Error(message)}
const html=read('question-bank.html'),workflow=read('styles/teacher-question-workflow.css'),admin=read('styles/question-bank-admin.css'),js=read('src/65-question-bank-admin.js');
assert(html.includes('class="tq-entry-toolbar"'),'快捷录题三组工具应合并到统一工具栏');
assert(!html.includes('右侧可填写知识点名称或联想库节点 ID'),'旧版“右侧填写”提示应移除');
assert(html.includes('qb-recall-status-help'),'快速回忆卡片应有用途说明');
assert(/tq-batch-options\{grid-template-columns:repeat\(2/.test(workflow),'批量导入选项应稳定为双列对齐');
assert(admin.includes('qb-recall-status-card-actions'),'回忆状态卡应提供显式操作区');
assert(js.includes('data-edit-recall-binding')&&js.includes('focusRecallBindingEditor'),'回忆状态卡的编辑入口应具备实际交互');
assert(js.includes('api?.choices?.'),'状态卡应检查真实后续分支，而不仅是节点是否存在');
console.log('v862-p211-ui-maintenance-ok');
