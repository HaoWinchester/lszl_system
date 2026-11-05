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
- 完整候选通过后从发布分支快进main并经指定代理推送，远端引用核验一致；正式部署源码提交e3930b28。

## 正式备份与上线结果

- `PYTHONDONTWRITEBYTECODE=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=status.showUntrackedFiles GIT_CONFIG_VALUE_0=no bash deploy/update.sh`退出0，耗时145秒。备份阶段62秒，发生在任何正式代码同步、镜像构建、容器重启及迁移之前。
- **正式备份目录：`/home/ubuntu/lszl-backups/20261105_130747`**。原生脚本完成代码归档、数据库custom dump、非空、tar目录和pg_restore TOC校验，并生成manifest、保留当前运行镜像标签。
- `repo_20261105_130747.tar.gz`：42047427字节，SHA256 `92366bc44e944313e7f406cbc4c1d850b7b3043f74e3de5a3fd95c9cb6128cf0`。
- `db_20261105_130747.dump`：223427047字节，SHA256 `2a68d496ad377c86c620bb37320cf519530e29a024052e6df0d594fc14521339`。
- 备份目录仅属主可访问，两文件权限600；独立核对manifest、非空、摘要与回滚镜像`lszl-kg-backend:rollback-20261105_130747`仍存在。没有下载或输出数据库内容、密码或密钥，也未删除既有备份。
- 正式管理器按相同source/site/context复用刚通过的420完整验证，frontend-build阶段3秒；未使用跳过检查标志。runtime打包420和418，实际生产411另由上述独立备份及镜像支持恢复。
- 服务健康检查通过，小程序29路由/13表就绪检查及教学助手检查均返回ok；正式磁盘剩余8.1GB。新版本上线不包含UAT数据库、测试账号、练习记录或试卷数据。

## 正式公网复核

- 正式入口：<https://lszl.aihuanpu.com/practice-mode.html>；页面meta与容器实际active release均为v9.0-p4.1.420，HTTPS健康status=ok、db=ok。
- 全部1276个线上site文件SHA256逐一与完整验证候选一致；变更涉及的6个后端模块（路由、目录、历史、计分、会话与HTML）指纹也一致。旧正式1253个文件全部保留。
- 公网1504×801、1366×768、1280×768、1024×768、768×844、390×844、320×568七种视口通过：无科目框、搜索右对齐、按钮37px且对齐、桌面一屏、整页不滚动、窄屏内容操作可达、向上规则说明无页面晃动、无JS错误。CLS最高0.00402。
- 首屏仍为2个脚本、12条目录摘要；真实公开目录响应8813字节，递归检查无题目正文、答案、metadata或大快照字段。图谱与做题关键5个业务包的公开HTTP指纹也与候选一致。
- 上线后浏览器仅进行公开页面、资源、提示与布局的只读检查，没有创建正式练习、代答、交卷或支付。PMP业务已在完整候选的隔离真实API流程中验证；180题适用范围保持用户确认值，185题卷不触发。
- 证据：artifacts/production-420/中的deploy.log、backup-verification.json、release-integrity.json、all-live-hashes.json、production-verification.json、health.json、catalog.json及production-lobby-*.png。
