# 手机做题标记按钮遮挡修复

## 问题与修改

“标记本题”使用绝对定位，脱离题卡排版。320px 长题干时，按钮位于 y=109～135.84，题干从 y=119 开始，发生重叠；801px 临界宽度也可复现。

在 `new-legacy/styles/practice-mode.css` 中将按钮改为正常 flex 子项，靠右排列，题干之前留出 12px 间距；800px 以下点击高度至少 40px。沿用现有按钮、事件和标记持久化逻辑。

当前工作区保留其他未提交内容，仅加入本次样式与布局回归检查，并同步本地生成产物。发布基于最新 `origin/uat` 在工作区内既有 UAT 工作树完成，不提交当前工作区的其他修改。

## 开发验证

- `python3 new-legacy/tests/practice-mark-show-answers-browser.py`：通过。覆盖普通练习和挑战模式、320/360/390/430/768/800/801/1440px、长短题干、标记和取消标记；检查按钮完全在题干上方且不超出屏幕，并保留答题卡、保存恢复和显示答案检查。新增检查已在修复前失败，修复后通过。
- `node --test new-legacy/tests/practice-*.test.js`：27/27 通过。
- `cd frontend && pnpm test`：240/240 Node 契约、9/9 Python 契约、4 项 UAT 部署隔离测试通过。
- `cd frontend && pnpm test:design`：5/5 通过。
- 390px 长题干截图人工查看：按钮与题干分离，选项可见。截图保存于 `.local-review/mobile-mark-390.png`。
- 候选 release 与 UAT 原 active release 均为 985 个文件，文件集合一致，`admin-console.html` 存在，候选样式与权威源逐字节一致。
- `git diff --check` 通过。

UAT 基线另有两条过期测试，本次更新测试以匹配既有约定：随机会话恢复沿用服务端冻结题序（用明确的倒序快照逐项验证），部署排除列表包含独立的小程序凭据文件。不改变这两项产品行为。原随机测试用修改前的 HEAD 内容重跑，确认同样失败。

## 发布状态

- 修复提交：`a737334`，已合入并推送 `uat`，远程引用已核对。
- 产物提交：`d2b9a35`，已推送并核对远程 `uat`。
- `bash deploy/update-uat.sh` 完整校验与部署成功，UAT 版本 `v9.0-p4.1.219`，包括后端完整 pytest、前端契约、集成页面和视觉校验。
- 首次发布在页面跳转期间出现一次认证刷新 `Failed to fetch`，在远端同步前中止；保留原检查不做放宽，重新运行完整流程后通过。
- agent-browser 在实际 UAT 390px 视口确认版本 219、按钮 position=static、min-height=40px、margin-bottom=12px；公网样式与权威源逐字节一致，HTTP 与 HTTPS 健康检查通过。
- 尚未进行实体手机测试与用户 UAT 业务验收。
- 本次不合入 `main`，不发布正式环境；开发自检不代替用户 UAT 验收。
