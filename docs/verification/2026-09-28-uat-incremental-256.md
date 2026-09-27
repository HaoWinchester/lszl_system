# UAT 256：画布修复与按需更新

## 发布内容

- 多标签页试卷选择不再引起画布循环重建；保留真正发布目录变化后的刷新。
- 画笔入口、笔形 SVG、颜色控件显示手形光标和操作说明。
- 纳入另一任务已完成的清理：删除根目录未使用的 JS Playwright package 文件和两份旧迁移报告。操作手册、备份、现有工作树未删除。

## 按需更新规则

沿用 `deploy/update-uat.sh` 和受管不可变 release；不手工覆盖运行中的静态目录。

1. 与远端 `.deploy-state/git-commit` 比较真实文件差异；基线缺失、未知文件、后端/部署配置、跨业务混合改动均回退 `full`。
2. 做题页沿用 `uat-fast`；画布核心、画笔和截图的明确白名单使用 `uat-canvas`。权威源与生成产物仍须确定性一致，不能仅靠修改生成文件进入快速路径。
3. `uat-canvas` 保留前端契约、版本/接口烟测、三类画布画笔/截图/持久化/只读检查、多标签页检查、归纳卡与错题业务检查及视觉回归；跳过无关做题、支付、内容制作和后端全套。
4. 文件传输仍使用 `rsync` 增量，不重新安装本地依赖。Docker 复用依赖缓存；纯前端配置仅 `build backend` 后 `up -d --no-deps backend`，不重建或替换助手 worker / 转换器。网页当前随镜像打包，因此仍需替换承载网页的后端容器，尚非零重启静态热更新。
5. 健康、助手就绪、公网版本核对和失败不推进部署状态等检查保留。第一次上线本规则因部署脚本本身变化走完整验证，未来白名单内改动才自动走专项。

## 开发验证

- 新增范围测试先失败后通过；后端、部署、认证及混合业务改动不能进入画布快速路径。
- 部署 shell 夹具先确认旧代码会整组重建，再验证新代码仅替换 backend。
- 独立审查指出 77 模块还承担归纳卡和错题行为，已把对应 `multi_question_learning_assets.py` 从跨业务组移到独立 `workspace-assets-e2e`，纳入 full 与 uat-canvas。
- 画布验证器使用候选 release、隔离 PostgreSQL 和单独 Chrome；不连接用户已打开的浏览器。

发布完成后的版本、提交、完整验证与 UAT 浏览器结果在本文件追加记录。正式环境不在本次发布范围内。


## 发布结果

- UAT 版本：v9.0-p4.1.256；运行代码提交：faa6d494c017208cc258737e645c03944aab4f3a。已快进合入 uat 并通过代理推送，远端引用一致；main 未变。
- 完整受管验证通过：903 项后端测试、283 项前端 Node 契约、9 项 Python 契约、部署脚本夹具、做题/跨业务/归纳卡与错题/画布/视觉检查。完整验证约 951 秒，实际部署复用结果，release-validation 仅 2 秒。
- 本次实际部署约 55 秒：rsync 6 秒，发送 7,536,563 字节（约 7.5 MB），镜像与服务步骤 15 秒，健康检查 14 秒。服务器剩余约 8.1 GiB。
- 已保留 UAT 回退镜像标签 lszl-kg-backend:uat-before-256 和 lszl-teacher-assistant:uat-before-256。本次不涉及正式环境部署。
- 上线后独立 Chrome 验证通过：知识图谱、多题归纳、深度回忆的入口折叠、手形光标/提示、颜色、绘画、PNG、双击清除/撤销、持久化；两个不同试卷的标签页保留正确试卷和选中卡片，观察期间 DOM 不被重建。
- 从 UAT HTTPS 读取的 77-multi-question-workspace.js、94-canvas-ink.js 和 canvas-ink.css 哈希与发布产物一致。
- 临时验证账号与其依赖数据已清理，未改动真实教师/学员内容。此次浏览器验证是开发自检，待用户业务验收后才考虑 main/正式发布。

证据：artifacts/canvas-flicker/release-256.log、deploy-uat-256.log、verify-uat-256.log、cleanup-uat-256.log；frontend/new-legacy-releases/v9.0-p4.1.256/validation.json；artifacts/canvas-tools/uat-results.json。
