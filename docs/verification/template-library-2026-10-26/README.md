# 模板中心分类与个人图谱隔离验证

日期：2026-10-26。设计已由用户确认。本记录覆盖本地开发自检，UAT 部署及用户业务验收由后续阶段完成；main/uat 在 Task 4A 与本次最终修复中均未修改。

## 本地实际运行版本与回滚来源

- 本地 active release：`v9.0-p4.1.396`；previous：已核验的 `v9.0-p4.1.394`。395 保留在磁盘作为历史验证版本。
- 本次先通过官方管理器 promote accepted 394，再构建/验证 396，未手工修改 site 或指针。396 共 1243 文件，保留 394 全部 1241 路径及 `admin-console.html`；两个新增文件为 `tests/template-gallery-browser.py` 和 `tests/graph-empty-current-browser.py`。
- 最初的本地预览 394 已整体保存在忽略目录 `.superpowers/sdd/2026-10-26-template-library/local-preview-394-release`。通过官方管理器先 promote 388，再从已核验的 Git 归档重建 accepted 394，随后发布 395；未手工复制 site 或编辑 release 指针。
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
- `/Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system/.superpowers/sdd/2026-10-26-template-library/local-after-qa-state.json`

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

## 仍待完成

独立最终分支审查后，由控制器执行 UAT 合并、代理推送、远端代码与数据库备份、部署及内容发布，并保存远端回执。自动化自检不代表 UAT 业务验收；必须停止在 UAT 阶段等待用户明确确认，不合入 main。
