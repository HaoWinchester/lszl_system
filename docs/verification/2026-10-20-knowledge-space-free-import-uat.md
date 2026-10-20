# 学习入口去重、三维知识星空与免费图谱导入（候选378）

## 用户要求及边界
用户明确批准去掉重复学习报告主入口，保留学习记录与每条记录报告；知识星空按提供HTML改暗色三维重力网络，真实练习数据。随后截图新增个人图谱“文件→导入”免费会员无权限，要求允许。其余大厅暂缓、成人模板暂缓、正式环境不发布；推荐双方7天规则保持。

## 已确认实现与定向验证
- Task1 efe0f403/d2773162：入口去重，独立spec/quality审查通过。
- Task2 25aa66ec/b8c6e85a：有界三维重力、排斥与弹簧场景；真实鼠标、触摸、取景、缩放、静止停止、隐藏/销毁回归通过，两个P2修复已独立复审。
- Task3 c9c2fb6c：真实面板集成，桌面/手机布局、详情/列表/分组/分页与账号销毁；独立spec/quality审查PASS。定向Node15项、面板11组、场景/大厅/弹幕/语言浏览器及当前前端376契约/9运行时/4部署脚本套件通过。
- root真实API独立数据库闭环：20次真实作答→20真实考点→Canvas/列表/详情→重开统计不变，12检查全部通过，无页面错误。证据artifacts/knowledge-space-20261020/api-integration-1/，临时数据库清理为空。
- Task4已定位菜单误用教师importData，修正为个人editGraph；源浏览器RED确认免费student被拦，GREEN覆盖6身份。另修正20导入器旧本地写入路径，复用现有EditorStoreBridge；真实API free导入→保存→刷新重开/原文件保持已exit0，升级付费与teacher/admin/viewer/guest边界也通过。任务审查/全分支审查与官方完整门禁尚在执行，本文不是上线或验收通过声明。

## 验证限制
额外探索的历史脚本learning-entry-answer-feedback.test.js引用早已缺失的question-training.css，未纳入当前活动契约，已如实记录；现有活动套件通过。自动化测试不等于用户UAT业务验收。

## 发布准备
候选VERSION378，当前已部署UAT377。发布前备份/home/ubuntu/lszl-uat-backups/20261020T063848Z已校验代码包、PG dump、TOC和SHA，manifest记录原377/正式336容器镜像。不得删除既有备份；main保持b76862ed，未经用户验收不得合入。

Task4提交7e78d585；最终当前活动前端377/377+9运行时+4部署脚本全通过。候选源1218/public1230，377旧路径无删除、admin-console存在。候选378全分支审查与官方full尚未完成；不能把定向检查当发布成功。

Task4独立审查提出创建后读取失败的Important：API当前文件已切换但画布仍原图。fix round1在共享bridge记录原ID，读取失败恢复选择并按现有trash→permanent规则清理创建记录。真实API仅新文件GET503错误注入验证通过，恢复原current/画布/原图内容且无额外文件；随后正常导入/角色边界仍通过。fixture53172退出0、无剩余DB；证据artifacts/free-graph-import-20261020/fix-1-api-green.log。初次故障注入范围过宽也拦截folders/tags，已纠正，未把该运行当有效回归结论。定向共享桥/远程store/adapter/tab测试4/4通过。待 scoped re-review。

最终全分支审查发现一项P1：导入await创建期间未持有Tabs切换锁，原图并发编辑可能丢失。单次修复波431a6611复用Tabs.withSavedFileTransition及已有草稿提交/保存，并让共享交互模式write能力检查同一切换状态。真实延迟POST回归：锁定、canWrite、卡片双击、新建页签、关闭页签、原图草稿保存均true；原图与导入图刷新保留，故障回滚/角色回归继续通过，fixture56706清理无遗留。根目录frontend-final-preflight.log最新全套377+9+4退出0。最终scoped复核待返回，再完整full。真实ink草稿成功未单独验证，仍保留既有安全中止；无readonly绕过。

最终复核knowledge_import_final_review针对994e6b51..431a6611确认P1ADDRESSED，无新Critical/Important，无其他观察。所有实施与审查完成，SDD归档artifacts/knowledge-space-20261020/sdd-review-archive/，进入官方完整full378。正式上线与用户UAT仍未完成。
