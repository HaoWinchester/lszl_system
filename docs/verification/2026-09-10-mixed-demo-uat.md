# 新题型体验卷 UAT 发布

## 用户入口与样卷

- 地址：https://uat.aihuanpu.com/practice-mode.html
- 试卷：**新题型体验卷（图表·案例·连线）**；选择后点击“开始挑战”。
- 共 5 道计分题：图表单选 1 道、共享案例单选 3 道、四对匹配题 1 道。
- 题库 ID：`b_d362bd68e16741d6b048d3353b784a7a`。
- 试卷 ID：`p_18077c93b0e94ade9b3998f9c6eb1189`。
- 发布版本 ID：`pr_49c833ab66634bf9a9281a1777446eb9`（样卷第 2 版，修正角色权限）。
- 根据用户 Word 整理的 JSON、原图和 UAT 专用发布工具保存在 `docs/samples/mixed-question-uat-20260910/`。样卷已通过应用服务正式写入 UAT 题库并发布，可在管理页面继续编辑。

## 部署结果

- UAT active release：`v9.0-p4.1.226`，部署代码：`1e0156f2e2ba4fcece83d0a4365aa2e6979668f2`。
- 用户清理磁盘后执行 `deploy/update-uat.sh`，完整发布检查、镜像构建、迁移及公网版本核对通过。
- 最终 full 验证开始于 2026-09-10 13:28:37 UTC，完成于 13:39:52 UTC，候选与本地 active site 均为 990 文件，关键页面齐全。
- 最终部署前备份：`/home/ubuntu/backups/lszl-kg-uat/20260910T132816Z-mixed-question-demo`；包含已校验非空且可读取的 `code.tar.gz`、`uat.dump` 和 `manifest.txt`。
- 首次样卷上线备份：`/home/ubuntu/backups/lszl-kg-uat/20260910T125731Z-mixed-question-demo`；首次显示补丁尝试前备份：`/home/ubuntu/backups/lszl-kg-uat/20260910T131358Z-mixed-question-demo`。既有备份均保留。
- 最终 UAT 健康接口及数据库状态正常。生产后端容器 `64b568550a53`、共享 PostgreSQL 容器 `282eae570aeb` 与发布前一致；未部署生产，未合并或推送 `main`。

## 实际浏览器验证

使用独立临时学生账号，在真实 UAT 上完成全部五题：

- 大厅可见体验卷，答题卡和成绩均按五题计数。
- Word 图表图片加载、点击放大成功。
- 案例共享材料及补充背景完整；桌面分栏、手机上下排列，材料可折叠，无页面横向溢出。
- 匹配题支持真实拖拽、键盘选择；完成一对后退出，刷新继续作答仍保留该配对。
- 全部按原答案作答，服务端最终判分 5/5；无页面脚本错误。
- 最终发布后额外检查桌面和手机匹配文字均未溢出。

截图及自动检查结果位于当前工作区 `.superpowers/uat-mixed-demo/`：`uat-chart.png`、`uat-case-desktop.png`、`uat-case-mobile.png`、`uat-matching.png`、`uat-matching-mobile.png`、`uat-result.png`、`browser-result.json`。

## 发布中修复的问题

1. 真实样卷的匹配场景较长，继承全局按钮的 `white-space: nowrap`，导致文字进入配对框下方。公共 `question-materials.css` 已允许场景与候选换行，并处理连续英文；独立浏览器回归在修改前复现桌面溢出，修改后桌面/手机均通过。
2. 冒烟测试登录后立即刷新、跨页面快速导航，会中断仍在执行的订阅认证请求并误报 `Failed to fetch`。测试现在等待 API 请求短暂稳定后再导航，保留全部控制台与 HTTP 错误断言；单独连续运行两次和最终 full 流程均通过。未修改业务认证逻辑。

## 登录后体验卷消失修复

- 用户反馈登录后体验卷消失。UAT 原发布版本仅允许 `student/viewer`，未登录目录按学生角色展示，管理员与教师登录后则被过滤，取题同样被拒绝。此前实际浏览器测试仅覆盖学生账号，遗漏这两个角色。
- UAT 专用 `publish.py` 改为显式发布给 `admin/teacher/student/viewer`，通过既有发布服务生成样卷第 2 版；未改全局访问控制。旧版 `pr_1682f2bfc62e49dbb1503239fdc0fd75` 保留为历史版本。
- 操作前代码与数据库备份：`/home/ubuntu/backups/lszl-kg-uat/20260910T140944Z-mixed-question-demo`，归档、dump 非空且读取校验通过。
- 直接在 UAT 使用应用服务验证：guest 目录可见；四种登录角色的目录、详情、完整 5 道题读取均通过。两版题目快照逐项相同，重复执行发布工具保持相同 release ID，没有产生第 3 版。
- 本地 `backend/.venv/bin/python -m pytest tests/test_paper_releases.py -q`：19 passed；`git diff --check` 通过。本次浏览器控制连续超时，未验证用户当前浏览器刷新后的显示，不能将服务端角色检查视为本次浏览器实测。
- 本次仅修正 UAT 样卷发布数据及专用工具，无需重建应用镜像；运行版本仍为 `v9.0-p4.1.226`。

以上属于开发自检。用户本人 UAT 业务验收仍待完成。
