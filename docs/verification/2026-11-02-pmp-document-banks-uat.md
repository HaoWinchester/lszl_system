# 两份 PMP 文档题库：UAT 导入与开发验证

2026-11-02（Asia/Shanghai）。当前状态：192题已导入UAT；预览修复v9.0-p4.1.405通过完整发布门禁并已部署，部署后数据回读与六道真实题目的页面复验均通过。用户业务验收待完成，未合入main。

## 数据结果

| 题库 | 题数 | 单选/多选 | 公共材料 | 案例子题 | 图表引用 |
| --- | ---: | --- | ---: | ---: | ---: |
| PMP新版中文题库（原96题版·实收93题） | 93 | 84 / 9 | 5 | 15 | 5 |
| PMP小程序新题型合集（截图整理版） | 99 | 95 / 4 | 15 | 67 | 17 |

- UAT管理入口：<https://uat.aihuanpu.com/question-bank.html>。两库由现有UAT管理员`admin`持有，均仅教师可见，未创建或发布学员试卷。
- 文字题库ID：`b_2af33e165efc4055aae0065410ed9fa6`；截图库ID：`b_c8887ec55418460c8c77b74d52d6b85f`。
- 文字版正文实为93题，保留Q01–Q96原题号中的93个，缺Q16/Q49/Q72，不补造。Q30/Q35/Q36按已确认方案转为单选；Q90完整保留A–F六项，答案A/C/D。
- 截图版136个图片资源、137次引用全部逐项对照，102道候选中收录99题。截图30重复残片去重；截图23多解、28预算口径及活动歧义、117/118源站答案冲突三题隔离。完整原文和原因保存在[校订清单](../samples/pmp-documents-20261102/mini-review.json)的`excluded`。
- 8张数据表保留行列、单位和数值；图表仅提取必要区域。未把完整带答案的截图作为题面图片。案例背景单存，子题保留各自新增条件。
- 知识点、原则、关键词等认知标注未擅自生成，保留待分类状态。

## 导入与重复执行

使用[本批导入工具](../samples/pmp-documents-20261102/import_uat.py)调用现有应用服务，不直接写业务表。默认dry run；写入前校验ENV、连接URL和实际数据库均为UAT，必须是现有启用管理员。无覆盖或清理重复题的确认标志。

- 首次导入：`add=2, replace=0, conflict=0, duplicateQuestionCount=0`。
- 实际重复运行：`add=0, replace=0, skip=2, hasChanges=false`。
- 逐题回读：192题题干、选项顺序、完整答案、解析、来源全部一致；82个案例子题的材料内容、组序和总数一致；22处图片引用的服务器资源bytes与本地图表一致。
- 首次回执和回读结果：[imported.json](../samples/pmp-documents-20261102/imported.json)、[verified.json](../samples/pmp-documents-20261102/verified.json)。原文、数据包和图表SHA256：[manifest.json](../samples/pmp-documents-20261102/manifest.json)。

## 必要的预览修复

真实UAT双击截图136对应题时，数据库答案为B/E，但原预览显示“未设置”且没有正确高亮。根因是共享`QuestionPreview.viewModel`只按单值`correctAnswer`判定，同时题库和试卷预览也只格式化单值。

- 共享答案模块新增`correctAnswerText(question)`，复用现有规范答案集合及匹配格式化。
- 共享预览模型按完整答案集合标记正确选项；题库和试卷预览统一调用公共格式化入口。
- 未修改页面布局、DOM结构、完成度计算或知识点分类逻辑。

## 验证证据

- 全部数据通过现有schema、答案和案例分组校验；人工校订数据与生成包逐项一致；全部137次截图均有明确去向，图表没有选项/答案泄漏。
- 相关Node回归30/30，真实Chromium预览组件交互10/10（两种预览×Q90、截图136、单选、匹配、未设置），先红后绿。截图136原错误和修复前实页证据已保存在本地验证目录。
- 根工作区前端契约383/383、运行期契约9项、部署脚本4组通过；设计契约5/5。
- 隔离副本补齐测试产物目录后，官方full门禁完整通过，无跳过项：后端1276/1276、前端383/383，以及落地页、扩展契约、隔离API/runtime、核心练习、画布、跨域、工作区资源和视觉浏览器检查全部通过。视觉差异为0–0.001%。完整门禁用时约24分43秒。
- 部署后在真实UAT题库逐次搜索并双击预览六道题：文字Q90（六选项，完整显示A/C/D）、Q32（案例表格）、Q35（图表），截图136（完整显示B/E与案例背景）、058（风险矩阵与背景）、029（网络图）。题干、选项、正确标记、答案、解析、案例和图片加载均通过。浏览器未模拟接口响应；只读验证拦截了自动编辑锁及分析上报请求，未修改业务数据。
- 部署后再次逐项回读192题、82个案例子题和22处图表引用，全部一致。线上active release全部1250个文件SHA256与验证候选一致，`admin-console.html`存在。
- 先前额外的旧`content-prep-question-bank-integration.test.js`静态断言仍在控制器中查找接口URL与旧刷新函数。当前操作已迁到`KGTeachingContentApi`公共适配器；控制器应用其回读结果。两相关文件相对任务基线无修改，现行`teaching-content-api-cutover.test.js`21/21通过。未为通过旧断言扩大本次变更。
- 额外旧Focus/Vega和p353脚本含过期的样式/版本/选择器断言；未把这些脚本记为通过。

发布405相对旧active404：1250对1248文件，原文件全部保留，仅新增两回归测试文件。业务源码、同步产物和候选逐字节核对一致。`deploy/update-uat.sh`九阶段全部通过，用时60秒；线上版本为`v9.0-p4.1.405`，部署代码为`cc9906deb6c0e1a5c9c684adb5d7ab65bf0295d5`。正式环境镜像部署前后均为`sha256:a2360d53000007719b9c8fb3d67b8dd75dfd90485573c0401b0bb6a6e98e002f`。

## 备份、分支与状态

导入前远端备份：`/home/ubuntu/lszl-uat-backups/pmp-documents-20261102T031833Z`。代码归档132330703字节、数据库dump28121721字节，均非空并通过归档目录/pg_restore TOC及SHA256验证；[manifest](../samples/pmp-documents-20261102/uat-backup-manifest.json)已保存。

预览修复部署前再次备份（已含192题）：`/home/ubuntu/lszl-uat-backups/pmp-documents-20261102T033405Z`。代码归档133238061字节、数据库dump29061842字节，均校验通过。原UAT镜像保留为`lszl-kg-backend:uat-backup-pmp-documents-20261102`，未删除历史备份。

数据提交`288561b5`、预览源码和同步产物提交`cc9906de`已合入并通过指定代理推送uat，功能分支保留在`cc9906deb6c0e1a5c9c684adb5d7ab65bf0295d5`。本验证记录随后单独提交uat，不改变已部署业务代码。main本地及远端保持`c36ad7771cbff9b152a58f055fc976e14ecc9f8d`，未执行main合并或推送。

完整发布校验在当前工作区内的隔离副本运行，根目录已有`docs/local-preview/`和`docs/promo/`均保留。本地证据目录为`docs/local-preview/pmp-import-assessment-20261102/`；其中`full-validation-summary.json`为完整门禁摘要、`deploy405.log`为发布日志、`runtime405-verification.json`为线上全文件校验、`live-uat-405/report.json`及同目录截图为六题实页复验、`uat-after-deploy-verified.json`为部署后数据回读。原始DOCX另在忽略的`artifacts/pmp-document-import-20261102/originals/`保留。

开发自检不替代用户本人UAT业务验收。验收完成后才可按项目纪律进入main。
