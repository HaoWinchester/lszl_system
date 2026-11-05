# 做题系统正式发布执行记录

## 授权与范围

用户明确要求“部署到正式环境”，据此执行本次做题系统的main集成及正式发布；不把自动化检查冒称为用户业务验收。

- UAT已部署419：图谱卡片做题图标及more大厅入口、目录/历史摘要投影与分页、首屏脚本延后加载、原有外观恢复、大厅控件对齐及一屏展示、图谱做题弹窗、180题PMP整卷固定10道不计分题。
- main起点6941af5c，实际正式运行411。UAT另外包含未验收的独立运营工具修改，本次不合并其12个tools/xhs-operator文件及1份运营记录。
- 从main建立codex/production-study-419，逐项集成ff0a3bdc之后的做题系统提交，无冲突；集成后与UAT仅差上述13个独立路径。独立只读复审确认做题系统backend/frontend/new-legacy/deploy/compose一致，main具备快进条件。
- 最终候选420，业务提交21485b35（对应UAT691c2d2f），验收测试补强586971c8。backend API/services、new-legacy/src/styles、服务端适配器均与UAT419一致；home-shell.css、home-graph.js、practice-lobby.css/js、practice-report.js五个业务包逐字节相同。
- PMP仍只对新建180题PMP整卷practice/challenge启用。既有185题卷、短练、旧会话和历史报告不改，不复制UAT试卷或学习数据。

## 发布前完整检查及测试修复

- 第一次419重检的后端1311项、前端404项、做题浏览器均通过，但原案例跨模式测试在直接改宽度后立即刷新，偶发读到1320而非900，完整门禁据此中止。正式环境没有同步、重建或重启。
- 以真实保存PUT延迟800ms复现：刷新GET先读旧1320；等待KGCanvasWorkspaceAdapter.flush真实成功回执后重开宽900。原画布业务代码与正式411无差异，原测试未等待350ms异步保存，pagehide本来仅是best effort。
- 只在原case-learning-modes-browser.py补6行：等待保存回执、真实GET核对本节点宽900及caseLayoutVersion=1，再执行原reload及900断言。六场景通过，独立复审确认没有弱化门禁或修改业务页面。
- 按不可变源要求递增420，重新执行完整发布验证，不使用跳过标志。首轮失败记录保留在artifacts/production-419/，420验证及最终部署证据在artifacts/production-420/。
- 本地1206个未跟踪文件全部为既有docs/design-previews、docs/local-preview、docs/promo用户文档，保留不动。发布前审核此白名单及已跟踪/暂存区干净；仅对部署命令调整status的untracked展示，验证器git ls-files输入逐字节不变。rsync本身排除/docs，独立复审确认不降低source/site/context或备份检查。
- 实际正式411的1253个site文件全部包含于候选1276文件中，关键页面齐全。读取的是容器实际active release，不把宿主旧current159误当运行版本。

## 执行状态

420完整验证已通过：1630秒，profile=full、passed=true，后端1311项、前端404项及全部要求的浏览器/视觉检查通过；原案例重开断言的三个多题工作区场景均在完整候选门禁中通过。

- 已核对420及已通过的418的冻结source/site指纹，并确认工作源与420候选一致。首轮本地419失败记录保留，不手工改报告。完整420成功后通过原生promote 418、promote 420得到current420/previous418，runtime打包再次确认两个受保护版本有效；UAT远端419验证记录未改。
- 最新只读正式清单仍为411/1253文件，候选420/1276文件，无删除。生产真实411的恢复将由正式脚本独立生成备份和回滚镜像，不以本地previous418替代。
- 当前尚未正式同步代码、重建镜像或重启。备份目录、上线及公网复核结果在实际完成后补充。
