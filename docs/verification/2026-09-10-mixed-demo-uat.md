# 新题型体验卷 UAT 发布

## 用户入口与样卷

- 地址：https://uat.aihuanpu.com/practice-mode.html
- 试卷：**新题型体验卷（图表·案例·连线）**；选择后点击“开始挑战”。
- 共 5 道计分题：图表单选 1 道、共享案例单选 3 道、四对匹配题 1 道。
- 题库 ID：`b_d362bd68e16741d6b048d3353b784a7a`。
- 试卷 ID：`p_18077c93b0e94ade9b3998f9c6eb1189`。
- 发布版本 ID：`pr_1682f2bfc62e49dbb1503239fdc0fd75`。
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

以上属于开发自检。用户本人 UAT 业务验收仍待完成。
