const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
function assert(condition,message){if(!condition)throw new Error(message)}
const context={globalThis:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'src/98-teacher-workflow-p2-services.js'),'utf8'),context);
const S=context.globalThis.KGTeacherWorkflowP2;
function block(n){return `【题干-中文】\n批量切换测试题 ${n}\n【A-中文】\nA${n}\n【B-中文】\nB${n}\n【C-中文】\nC${n}\n【D-中文】\nD${n}\n【答案】\n${n%2?'A':'B'}\n【解析-中文】\n解析 ${n}`}
const raw=[1,2,3,4,5].map(block).join('\r\n\r\n===== 下一题 =====\r\n\r\n');
const parsed=S.parseQuestionBatch(raw);assert(parsed.total===5,'精确分隔线应解析 5 道题');assert(parsed.validCount===5,'5 道题均应通过');assert(parsed.items.map(x=>x.stem).join('|').includes('测试题 1')&&parsed.items[4].stem.includes('测试题 5'),'应保留首末题而非只识别最后一道');
const full=[block(1),block(2),block(3)].join('\n＝＝＝ 下一题 ＝＝＝\n');assert(S.parseQuestionBatch(full).total===3,'全角等号分隔也应识别');
const workflow=fs.readFileSync(path.join(ROOT,'src/97-teacher-question-workflow.js'),'utf8');assert(workflow.includes('data-tq-batch-prev')&&workflow.includes('data-tq-batch-next')&&workflow.includes('data-tq-batch-jump'),'批量解析结果应提供多题切换导航');
const css=fs.readFileSync(path.join(ROOT,'styles/teacher-question-workflow.css'),'utf8');assert(css.includes('.tq-batch-default-grid{grid-template-columns:repeat(3,minmax(0,1fr))}'),'默认分类摘要应使用可收缩网格');assert(css.includes('overflow:hidden;resize:none'),'批量分类弹窗应限制在视口内并使用内部滚动');
console.log('v90-p3332-batch-paste-navigation-ok');
