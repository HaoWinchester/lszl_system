# 学习入口去重、三维知识星空与免费导入：UAT v378

已于2026-10-20部署UAT https://uat.aihuanpu.com ，版本v9.0-p4.1.378。开发自检与部署验证通过；等待用户本人业务验收，不合入main。

## 交付范围
- 免费student可从首页文件→导入打开文件选择器并导入个人图谱，使用editGraph；教师题库importData权限不向student开放。
- 个人图谱导入复用共享远端桥，创建/读取成功后才应用；刷新后内容保留、原图不被覆盖。创建后读取失败恢复原current并清理新记录；错误不报成功。
- 导入复用共享文件切换锁及草稿提交/保存；网络等待时禁止原图编辑和页签新建/关闭，防止并发编辑丢失。
- 去掉重复学习报告主入口，保留学习记录及记录内查看报告。
- 知识星空为暗色三维重力网络，旋转/缩放/选点/详情/分组/列表/分页，真实作答数据、owner隔离、60条/页；练习新鲜度语义保持。
- 其余大厅暂缓需求、成人模板/公开课等保持暂缓；推荐人与新用户各7天规则不变。

## 实现与审查
Task1 efe0f403/d2773162；Task2 25aa66ec/b8c6e85a；Task3 c9c2fb6c；Task4 7e78d585/c9a7ff87；最终编辑保护431a6611。任务规范/质量审查及最终全分支审查均通过。审查发现的场景取景/空转、导入部分成功恢复和并发编辑P1均已修复并复审，无未解决Critical/Important。
所有SDD报告、差异、截图归档artifacts/knowledge-space-20261020/sdd-review-archive/，原本计划工作目录已清理，兄弟目录未动。

## 验证证据
- 官方完整full：2026-10-20T07:12:16.262Z→07:33:01.238Z，1243秒，passed=true、profile=full、未skip。后端1145通过（3项既有依赖警告）；前端377/377、9项运行时与4组部署脚本通过；扩展10项；全部做题/画布/跨域/资产/视觉浏览器组exit0。
- 整包source1218/site1230/public1230。source snapshot及site/public逐字节相同，旧377的1226路径及旧369的1161路径无删除，admin-console存在。
- sourceHash `2f74d835425fa7ab43678b23a904f960e2f407eb6ed28fd6e5d51f44ea817d4e`；adapterHash `d8a633866d899791325f322f287bae340e2650c66680242d83807f048f4873f0`；validatorHash `e0f001f06bcc699181661f94c4d840244ec8a3076b70c32e9fe92d9f61b1e43c`。
- 真实学习数据闭环：20次保存作答→20服务端考点→Canvas/列表/详情/重开，12组检查通过，fixture36126清理无遗留。证据api-integration-1.log。
- 真实免费导入：确认free/default套餐，实际菜单chooser→延迟POST→新文件API落库→刷新保留节点/说明/连线；原图保存真实inline草稿。等待期间双击编辑/新建/hover关闭均被阻止；新文件GET503后恢复原图并清理部分记录。free/paid/teacher/admin/viewer/guest边界通过，学生题库403保持。fixture56706退出0、无临时DB；证据artifacts/free-graph-import-20261020/final-fix/api-green/及api-green.log。
- 官方完整门禁再次运行上述免费导入真实API回归通过。完整日志frontend/new-legacy-releases/v9.0-p4.1.378/validation-run.log，outer full-update-378.log。
- UAT部署官方脚本exit0，52秒；公网5页/88关键静态资源SHA一致，健康/DB正常、游客管理页403/私有API401；容器1230文件、12后端SHA、Alembicc8d4e7f2b610、推荐奖励列和暂缓模板0核对通过。

## 发布与备份
部署代码提交`be947a602b2ff33c9acd803714482d3978f15b86`，已合入/代理推送uat和功能分支，远端引用已核对。正式main仍b76862ed2d12d36a6c3d0b6782f5bd601f12d8a5，正式版本336、容器镜像未变。
UAT当前 `fff9e8ec32bad2bd069c964e925b9255a12a17b707c2b93110349fd1a3cd7627 sha256:d5b99a73fdc19a838c890852cd67e62e8da67f1ff7615180fa52ab47064088af`，previous377。
发布前远端备份 `/home/ubuntu/lszl-uat-backups/20261020T063848Z`：代码49591150B，SHA312cccb29f25601d0373b2583da3379aec085ad2474edc634065a4419a5f8e03；PG27567519B，SHAb51f5f2d86475e55e9ec12b9fe71bf51ca25d918070aba20413dd1cdcdf3bbe9。非空/归档/TOC/manifest已校验，377回滚镜像tag保留，旧备份未删除。
部署日志artifacts/knowledge-space-20261020/deploy-uat-378.log；公网/容器/local校验JSON及runtime记录在同目录。

## 验证边界
自动化不是用户UAT验收。真实草稿成功覆盖节点inline；真实ink草稿可能保留既有安全中止并保持草稿，本轮未单独浏览器验证成功，不绕过readonly。成功导入用JSON，ZIP共用未改parser，未声称另跑ZIP/XMind完整E2E。回滚中第二次API故障可能保留记录/选择，但会明确失败不报成功。
额外探索的历史learning-entry-answer-feedback.test.js引用早已缺失question-training.css，未纳入当前活动套件；已如实记录，当前活动全套通过。历史测试诊断失败（宽泛注入或缺少hover）已修正，未冒充业务回归通过证据。
