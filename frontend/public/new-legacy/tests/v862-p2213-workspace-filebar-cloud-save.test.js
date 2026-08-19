'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('question-workspace.html');
assert(!html.includes('id="qwPageTitle"'));
assert(html.includes('id="qwWorkspaceFilebar"'));
assert(html.includes('id="qwWorkspaceSaveState"'));
assert(html.includes('id="qwWorkspaceChip"'));
assert(html.includes('src/79-multi-question-workspace-filebar.js'));
assert(html.includes('M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.4 8.5'));

const filebar=read('src/79-multi-question-workspace-filebar.js');
assert(filebar.includes('function openTitleEdit()'));assert(filebar.includes("addEventListener('dblclick'"));
assert(filebar.includes('function manualSave()'));
assert(filebar.includes("String(event.key||'').toLowerCase()!=='s'"));
assert(filebar.includes('is-dirty'));
assert(filebar.includes('is-saving'));
assert(filebar.includes('is-error'));

const controller=read('src/77-multi-question-workspace.js');
assert(controller.includes('function renameWorkspaceTo(workspaceId,title)'));
assert(controller.includes('function manualSaveWorkspace()'));
assert(controller.includes("store()?.write?.(latest,{reason:'manual-save'})"));
assert(!controller.includes('KGServerStateStorage?.flush?.()'));
assert(controller.includes('KGMultiQuestionWorkspaceFilebar?.configure?.'));
assert(controller.includes('KGMultiQuestionWorkspaceFilebar?.markDirty?.'));
assert(controller.includes('KGMultiQuestionWorkspaceFilebar?.markSaved?.'));

const css=read('styles/question-workspace.css');
assert(css.includes('v8.6.2 P2.2.13 — current workspace file bar + graph-style save state'));
assert(css.includes('.qw-workspace-save-state.is-dirty{color:#d97706}'));
assert(css.includes('.qw-workspace-save-state.is-saving{color:#2563eb}'));
assert(css.includes('.qw-workspace-save-state.is-error{color:#dc2626}'));
assert(css.includes('color:#16a34a'));
console.log('v862-p2213-workspace-filebar-cloud-save-static-ok');
