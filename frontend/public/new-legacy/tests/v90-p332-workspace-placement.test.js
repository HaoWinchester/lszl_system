'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p3.3.2'){console.log('v90-p332-workspace-placement-skipped-for',currentVersion);process.exit(0);}

assert.equal(read('VERSION').trim(),'v9.0-p3.3.2');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.3.2'"));

const questions=read('question-bank.html');
assert(questions.includes('aria-label="题目管理页签"'),'题目管理缺少业务页签');
assert.equal((questions.match(/data-question-workspace="/g)||[]).length,2,'题目管理应只有题库与录入中心两个页签');
assert(questions.includes('data-question-workspace="entry"'),'题目管理缺少录入中心页签');
assert(questions.includes('data-embed-src="question-studio/index.html?embed=entry"'),'录入中心没有复用旧录入工作区');
assert(questions.includes('src/99-workspace-placement.js'),'题目管理缺少页签控制器');

const studio=read('question-studio/index.html');
assert(studio.includes("params.get('embed')==='entry'"),'录入中心缺少嵌入模式');
assert(studio.includes("../question-bank.html?workspace=entry"),'旧录入入口没有归位到题目管理');
assert(!studio.includes('href="../content-center.html"'),'录入中心不应继续导航到旧内容中心');
assert(studio.includes('提交到题库</button>'),'录入操作文案应归属于题库');

const subjects=read('admin-subjects.html');
assert(subjects.includes('id="adminCurrentTreeFrame"'),'科目与知识树缺少内嵌知识树工作区');
assert(subjects.includes('id="adminTreeWorkspaceTitle"'),'知识树工作区缺少标题');
assert(!subjects.includes('href="content-center.html#knowledge"'),'科目页面不应继续跳到旧内容中心');
assert.equal((subjects.match(/data-subject-tab=/g)||[]).length,3,'科目页面应保持当前知识树、待分类题目、历史版本三个页签');

const subjectApp=read('src/admin/51-admin-subjects-app.js');
assert(subjectApp.includes('content-center.html?embed=knowledge'),'当前知识树页签没有加载知识树组件');
assert(subjectApp.includes('admin-subjects.html?subjectId=${encodeURIComponent(item.subjectId)}&tab=current&taxonomyId='),'历史版本查看应回到科目与知识树页面');

const content=read('content-center.html');
assert(content.includes("params.get('embed')==='knowledge'"),'旧内容中心缺少知识树嵌入模式');
assert(content.includes("new URL('admin-subjects.html',location.href)"),'旧内容中心直达入口没有兼容跳转');
assert(content.includes('src/99-embedded-workspace.js'),'知识树嵌入页缺少高度同步');
const placementCss=read('styles/workspace-placement.css');
assert(placementCss.includes('html.kg-embedded[data-embed-mode="knowledge"] .cc-library-panel'),'知识树嵌入模式必须隐藏活动库');
assert(placementCss.includes('html.kg-embedded[data-embed-mode="knowledge"] .cc-organize-panel'),'知识树嵌入模式必须隐藏旧内容整理区');

for(const file of ['teacher-workbench.html','course-admin.html','src/97-teacher-question-workflow.js']){
  const text=read(file);
  assert(!text.includes('content-center.html#knowledge'),`${file} 仍有旧知识树入口`);
}
assert(read('teacher-workbench.html').includes('question-bank.html?workspace=entry'),'工作台录入入口没有指向题目管理页签');
assert(read('teacher-workbench.html').includes('href="admin-subjects.html">科目与知识树'),'工作台知识树入口没有归位');

const nav=subjects.match(/<nav class="admin-context-nav"[\s\S]*?<\/nav>/)?.[0]||'';
assert.equal((nav.match(/data-admin-nav=/g)||[]).length,8,'管理后台顶部导航必须继续保持八项');
assert(read('src/admin/32-taxonomy-service.js').includes("if(item.status==='published'&&this.isCurrent(item))return 'current'"),'P3.3 当前知识树维护能力不能丢失');
console.log('v90-p332-workspace-placement-ok');
