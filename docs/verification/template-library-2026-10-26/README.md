# 模板中心分类与个人图谱隔离验证

日期：2026-10-26。设计已由用户确认。本记录覆盖本地开发自检和 UAT 部署自检；UAT 交付后用户明确授权正式发布，396 已合入 main 并上线，详见 [正式发布记录](production.md)。

## 本地实际运行版本与回滚来源

- 本地 active release：`v9.0-p4.1.396`；previous：已核验的 `v9.0-p4.1.394`。395 保留在磁盘作为历史验证版本。
- 本次先通过官方管理器 promote accepted 394，再构建/验证 396，未手工修改 site 或指针。396 共 1243 文件，保留 394 全部 1241 路径及 `admin-console.html`；两个新增文件为 `tests/template-gallery-browser.py` 和 `tests/graph-empty-current-browser.py`。
- 最初的本地预览 394 已整体保存在忽略归档 `artifacts/template-gallery/sdd-archive/local-preview-394-release`。通过官方管理器先 promote 388，再从已核验的 Git 归档重建 accepted 394，随后发布 395；未手工复制 site 或编辑 release 指针。
- accepted 394 与远端已接受版本 sourceHash 一致：`26aad91c2d602f59a2ed179176d229d692314f55cae9587fb6c11f79ae7d9fb2`。
- 394 为 1241 文件；395 为 1242 文件，保留全部原有 1241 路径和 `admin-console.html`；新增路径仅 `tests/template-gallery-browser.py`。文件数变化有明确来源。
- 395 的 VERSION、content-prep dist、同步产物、manifest、sync report 与 guided-course seed 均由现有官方构建/同步脚本产生。

## 实际 API 与浏览器验证

`python3 .superpowers/sdd/2026-10-26-template-library/integration-local.py --source-ids .superpowers/sdd/2026-10-26-template-library/expected-builtin-ids.json` 已通过。测试访问本地 5173 的真实 active release/API：

- 模板目录 53 个：PMP 30、PRINCE2 6、CSPM 6、高项 6、通用学习 5。
- 52 个内置源 ID 不在个人文件及页签中，直接读取均返回 404；3 个个人文件保留，进入及刷新恢复此前个人当前文件。
- 分类、搜索、空结果、清除搜索、目录失败重试通过；1440/1100/800/390 宽度分别为 4/3/2/1 列，无容器横向溢出。
- 实际 11 节点图谱预览、缩放和 Delete 键无源图谱/历史/个人文件变更；取消管理编辑没有 POST/PATCH。
- UI 使用模板创建独立个人副本，打开后通过内联编辑器修改、保存并刷新恢复；模板原始预览保持一致。测试只软删除自身副本并恢复此前个人当前文件。
- 既有 source gallery 浏览器契约亦通过：缩略图/目录重试、取消维护、只读渲染、加载失败与 receipt 重用。
- 根控制器在实际 QA 后复核：原有 37 个文件正文哈希及 revision 全部保持；导入前原有 138 个模板版本保留，既有 2 个个人模板副本保留。详细审计保存在忽略目录，未提交用户正文或会话信息。

## 395 历史检查与证据

- `pnpm test:design`：5/5 通过。
- `node frontend/scripts/manage-new-legacy.js update new-legacy`：完整验收通过（exit 0），1596 秒；validation.json 为 `passed:true`、`profile:full`，并非 skip。
- 后端：1235 passed，3 个弃用警告，832.13 秒。
- 前端：378/378 Node 契约、9/9 Python 契约、4 组 UAT 部署脚本契约通过；landing、extended contracts、隔离 API/runtime、核心练习、知识空间、模板账号、画布、跨域业务与资源浏览器阶段通过。
- 视觉回归：practice/free 的 desktop 差异分别 0.000%/0.001%，mobile 均 0.000%。
- 验证时间 UTC：2026-10-26 05:34:43 至 06:01:21。395 sourceHash：`cafef2eb61e6de5f6d3c1e32529d980e56282da9996eec29ccc2e6017f7c27f3`。

以下是此工作区中的实际证据位置（忽略产物，不含凭据）：

- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/site-comparison-395.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/integrated/result.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/integration-local.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/gallery-395.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/design-395.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/release-395-full.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/frontend/new-legacy-releases/v9.0-p4.1.395/validation.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/sdd-archive/local-after-qa-state.json`

实际界面截图（根控制器等待所有分类缩略图完成后采集）：

- [PRINCE2 桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-local/prince2-desktop.png)
- [CSPM 桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-local/cspm-desktop.png)
- [高项桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-local/gaoxiang-desktop.png)
- [PMP 桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-local/pmp-desktop.png)
- [PRINCE2 窄屏](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-local/prince2-narrow.png)

## 最终审查修复与 396 完整验证

应用修复提交：`a92f240e`。原 395 最终审查的两项 P2 已在现有公共模块修复：

- 远端当前文件成功返回 null 后，编辑器使用现有空白工厂并同步预览/保存基线；启动、登录及切换账户均渲染零卡片/零连线，平移缩放不创建文件。初始化失败保留既有行为；个人图谱恢复和访客行为保持。首次有效编辑经现有自动保存只创建包含新增卡片的个人文件。
- 公开题目绑定 set/refresh/revoke/batch apply 在写入前使用共享个人文件谓词拒绝 builtin-template 目标。保留角色、revision 校验与教学 advisory lock→文件行锁顺序；可信内部导出、发布及 source=template 个人副本仍可用。

回归先 RED 后 GREEN：旧画布状态为 11 而非 0，五种 builtin 写入原先返回 200；修复后编辑器 8 项、绑定边界 12 项及相关后端四个文件共 76 项通过。真实浏览器分别验证首次空响应、库源恢复后的 null 响应、登录、切换账户、个人文件恢复、初始化失败及访客七种情况。API 边界采用隔离 fixture；未修改共享真实账户图谱。服务端库源指针恢复另有真实隔离数据库测试。

`node frontend/scripts/manage-new-legacy.js update new-legacy` 的 396 完整验证已通过（exit 0；`passed:true`、`profile:full`），不是 skip 结果：

- 后端 1247 passed，3 个现有弃用警告，687.05 秒。
- 前端 383 Node 契约、9 Python 契约、4 组 UAT 部署契约通过；landing、extended、隔离 runtime/API、核心业务、画布、跨域、资源与视觉阶段全部通过。
- 新增真实画布空当前文件浏览器回归已接入管理器 canvas-browser 阶段并通过。
- 总计 1756 秒；UTC 2026-10-26 06:14:48 至 06:44:06。管理器完成时确认 source/site/运行上下文指纹未改变。
- 视觉差异：practice desktop 0.000%，free desktop 0.001%，两种 mobile 均 0.000%。额外设计契约 5/5、模板图库浏览器契约通过。
- 396 sourceHash：`1ffe1f4bddeb55d30f2d0a4ec919ed319ee31714e14b67904a12d85f1c3363c5`；siteHash：`07050ffe72bb7fea35fee33b688ca3afa6a8ec9c58f4fcdacb7aed5d61f235e5`。

396 的完整回执和定向证据：

- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/frontend/new-legacy-releases/v9.0-p4.1.396/validation.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/frontend/new-legacy-releases/v9.0-p4.1.396/validation-run.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/release-396-full.log`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/site-comparison-396.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/empty-current-396/result.json`
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/final-fix-backend-green-final.log`
- [396 初始空白画布](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/empty-current-396/initial-null.png)
- [396 登录后空白画布](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/empty-current-396/login.png)
- [396 切换账户后空白画布](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/empty-current-396/account-switch.png)

## UAT 交付历史（后续已授权正式发布）

- 地址：[https://uat.aihuanpu.com/graph](https://uat.aihuanpu.com/graph)，版本 `v9.0-p4.1.396`，previous 为 accepted 394。
- 独立最终复审通过，两项 P2 均已解决，无新增修复范围问题。应用与生成产物提交为 `a92f240e`、`bc3ff54c`。
- 已 fast-forward 合入 uat，使用命令级代理推送并核对远端引用；部署脚本标记的代码提交为 `bc3ff54ca840a4bb0e856fa358b552a70d47d3d5`。main 仍为 `056c95ca617825fbd408b17af464db349d4e0380`。
- 部署前备份目录：`/home/ubuntu/lszl-uat-backups/template-library-20261026T061606Z`。代码归档、运行时归档及 `kg_graph_uat` dump 均非空、可读，manifest 记录 SHA256；保留回滚镜像 `lszl-kg-backend:uat-template-library-20261026T061606Z`。未删除旧备份。
- `bash deploy/update-uat.sh` exit 0，96 秒。管理器复用已核验的完整 396 回执；迁移、容器健康、助手就绪和公网版本检查通过。新运行时包含 396 与已核验 394；未手工覆盖 site。
- 发布工具首先 dry-run：新 18 套均为 create，旧 PMP 30 套均为 unchanged。新包 apply 创建 18；再次 apply 创建 0/unchanged 18；旧 PMP apply 创建 0/unchanged 30。全部强校验 ENV=uat、数据库=kg_graph_uat。
- UAT 目录共 51 套：PMP 30、PRINCE2 6、CSPM 6、高项 6、既有通用学习 3。保留环境实存数量，未人为补删既有模板。
- 发布后及实际浏览器检查后两次比较均通过：原有 33 个模板 ID/当前版本/上架权限、33 个不可变版本、317 个文件的来源/正文哈希/revision 全部不变；仅新增 18 个模板、18 个版本和 18 个源文件。
- UAT 真实 Chrome：48 个内置源不在个人文件/页签中，逐个直接读取均 404；5 个现有个人文件保留，刷新恢复当前个人图谱。分类、组合搜索/空结果/清除、真实预览缩放、390px 单列无横向溢出通过；预览不创建副本、不切换当前文件。此轮远端页面检查没有文件或模板写请求，没有 pageerror。独立副本的创建/编辑/保存/刷新已在本地真实 API 验证；未在 UAT 创建测试副本。
- 正式环境容器 image 与启动时间部署前后相同；本轮未同步正式目录、重启正式容器、写正式数据库或合入 main。

UAT 证据位于 `artifacts/template-gallery/deploy/` 的 `uat-deploy.log`、`uat-backup-final.json`、内容发布回执、`preservation-result.json` 与 `preservation-after-browser.json`，以及 `artifacts/template-gallery/uat/result.json`。受保护的临时运维会话仅用于只读页面验看，已清除本地会话文件，未修改账户密码；没有提交会话、密钥、数据库内容或用户正文。

- [UAT PRINCE2 桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/uat/prince2-desktop.png)
- [UAT CSPM 桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/uat/cspm-desktop.png)
- [UAT 高项桌面](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/uat/gaoxiang-desktop.png)
- [UAT 手机](/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/artifacts/template-gallery/uat/prince2-narrow.png)

上述为 UAT 交付时的状态。之后用户明确要求“部署到正式环境”，已完成 main 合入及正式发布，详见 [正式发布记录](production.md)。main/uat 两个永久分支保留。

开发过程的 SDD 审查、回归脚本及本地来源审计已整体保存在忽略目录 `artifacts/template-gallery/sdd-archive/`；上文历史命令保留执行时的原始路径。临时 Git exclude 将恢复原始字节，既有 `docs/local-preview/`、`docs/promo/` 不纳入本轮提交且原样保留。
