'use strict';
const path=require('path');
require(path.resolve(__dirname,'../src/98-teacher-workflow-p2-services.js'));
const S=global.KGTeacherWorkflowP2;
function assert(condition,message){if(!condition)throw new Error(message)}

const multi=`1. 项目经理发现关键干系人误解目标，下一步做什么？
A. 升级
B. 沟通澄清
C. 修改章程
D. 忽略
答案：B
解析：先沟通。

2. 迭代中出现新需求，应首先做什么？
A. 直接加入
B. 让团队加班
C. 与产品负责人评估优先级
D. 取消迭代
答案：C
解析：由产品负责人排序。`;
const parsed=S.parseQuestionBatch(multi);
assert(parsed.total===2,'应拆分两道题');
assert(parsed.validCount===2,'两道题都应解析通过');
assert(parsed.items[0].answer==='B'&&parsed.items[1].answer==='C','答案识别错误');

const separated=S.parseQuestionBatch(multi.replace('\n\n2.','\n---\n2.'));
assert(separated.total===2,'分隔线应拆分两题');

const outline=S.parseCourseOutline(`# 阶段一
## 章节一
- 题干观察 | standard
- 关键词回忆 | deep_recall
## 章节二
- 知识图谱 | knowledge_graph
阶段：阶段二
章节：综合练习
步骤：多题归纳 | multi_question`);
assert(outline.errors.length===0,'课程大纲不应报错：'+outline.errors.join(';'));
assert(outline.counts.stages===2&&outline.counts.parts===3&&outline.counts.nodes===4,'课程大纲计数错误');
assert(outline.stages[1].parts[0].nodes[0].nodeType==='multi_question','节点类型别名解析错误');
assert(Object.keys(S.COURSE_TEMPLATES).length>=3,'应提供至少三个学习模板');
console.log('v862-p2-workflow-services-ok',{questions:parsed.total,outline:outline.counts,templates:Object.keys(S.COURSE_TEMPLATES).length});
