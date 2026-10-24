# 图表左栏与画布工具栏：UAT v9.0-p4.1.394

- 已部署版本：`v9.0-p4.1.394`；源码提交：`187a054f3a64f08663581ac4de8ceb46d3661d08`。
- UAT：<https://uat.aihuanpu.com/>。已于 2026-10-24 完成部署与开发自检，等待老师业务验收。
- `main` 不合入、不推送，正式环境保持 `v9.0-p4.1.336`。开发自检不代替老师的 UAT 业务验收。

## 需求与实现

| 截图标注 | 实现位置及行为 | 人工验收 |
| --- | --- | --- |
| 参考图表挪到题目左边 | 共享 `118-question-materials.js` 调整媒体与题目的 DOM 顺序；宽卡左图右题，窄卡上图下题。深度回忆、多题归纳共同生效；图片说明、放大和重试保留。 | 清单 P11，待老师确认 |
| 右上工具栏去文字 | 深度回忆启用已有 `iconOnly` 呈现方式，多题归纳维持已有图标模式；`title` 和 `aria-label` 保留。主题选择器保留名称。 | 清单 P12，待老师确认 |
| 搜索图标换放大镜 | 在共享工具栏图标表中增加放大镜，深度回忆搜索引用它。多题归纳原有搜索入口不变。 | 清单 P13，待老师确认 |
| 材料滚轮被画布抢占 | 真实案例阅读检查暴露旧问题：外层画布 `wheel` 监听器阻止了材料区滚动。在共享媒体绑定入口拦截案例区事件冒泡、保留默认滚动；空白画布仍处理缩放。 | 清单 P14，待老师确认 |

案例题原有 16:9 和手动宽度保持，纯文字题不产生媒体栏。知识星空、连线、作答与认证业务未改动。

## 已完成的定向自检

- `python3 new-legacy/tests/question-material-card-browser.py`：通过。普通图表、嵌套元数据图表、带图片案例、窄卡、无媒体、非法 URL、图片放大/Esc、加载失败及重试均覆盖。
- `python3 new-legacy/tests/case-card-layout-browser.py`：两个页面 × 1920×1080 / 1440×960 / 1280×720 / 390×844，共 8 组通过。覆盖 16:9、独立滚动、真实触屏手势、材料折叠展开、普通题/图片题回退；增加外层画布抢滚轮的回归检查，先失败再修复通过。
- `node --test frontend/scripts/remaining-learning-requirements.test.mjs`：4 项通过，包括本次工具栏回归契约。
- `cd frontend && pnpm test`：378 项前端契约、9 项 Python 契约及 4 组部署脚本检查通过；最终候选仍需经过完整发布校验。
- `SOURCE_OVERRIDE=1 python3 artifacts/media-left-toolbar-20261024/verify-ui.py`：UAT 真实发布试卷、真实登录/图片 API，两个页面 × 普通图表/案例共 4 组通过，无页面错误。只覆盖静态源码资源，不伪造业务 API 成功响应；验证画笔、搜索/空结果/关闭、图片放大/Esc、截图下载及案例阅读滚动。

## 备份与发布

部署前已校验当前 UAT 代码归档、数据库 dump 非空，归档目录可列出、数据库 TOC 可读取：

- 远端目录：`/home/ubuntu/lszl-uat-backups/20261024T100852Z`。
- `code.tar.gz`：51,857,537 字节；SHA-256 `bcaf90d3a02b613b6da2bab793e18e4ac02341f9d071cb144282126af7ab99be`。
- `kg_graph_uat.dump`：27,840,382 字节；SHA-256 `02ab9415996ac8bef4886544ad8916129ae592b3484d539fbba231ad24caf2e5`。
- 保留当前 UAT 镜像用于回滚，未清理正式环境或数据库备份。

发布通过现有 `deploy/update-uat.sh` → `manage-new-legacy.js update`，使用工作区内独立发布 checkout，避免把无关的 `docs/promo/` 工作纳入发布。完整发布及上线复查结果如下。

## 发布校验重试记录

首轮完整校验后端 1171 项、前端 378 项及此前浏览器检查通过，随后弹幕控件 13 项断言均打印 `ok`，但 `Browser.close` 挂起。检查未发现该驱动的浏览器子进程或活动网络连接后，终止仅属于此测试的挂起驱动；校验如实以关闭异常失败，`passed=false`，未 promote，UAT 仍为 393。首轮总计 1424 秒，日志保留于 `artifacts/media-left-toolbar-20261024/validation-attempt1.log`。

同一 checkout、同一脚本、同一断言独立重跑：`PYTHONDONTWRITEBYTECODE=1 python3 new-legacy/tests/danmaku-controls-browser.py`，13 项全部通过，19.869 秒，正常退出。随后重新运行完整官方发布脚本；未跳过检查或修改断言。最终完整重跑通过，详情见下节。

## 最终发布与上线复查

- 官方完整校验：`passed=true`、`profile=full`；2026-10-24T10:42:06.784Z 开始、11:09:43.318Z 完成，验证脚本总计 1655 秒。完整部署脚本正常退出，全部 9 阶段完成，总计 1703 秒。
- 最终后端：1171 项通过，834.54 秒，3 条现有弃用警告。前端：378 项契约通过，Python 与部署脚本契约通过；扩展契约、真实 API 做题/弹幕、知识星空、画布、跨页面、学习资产、视觉回归均通过。
- 首轮关闭异常后的弹幕控件检查在独立复测及最终完整流程中均正常通过、正常退出；没有改动测试断言或发布校验程序。
- `python3 artifacts/media-left-toolbar-20261024/verify-container.py`：UAT 容器实际 active release 为 394，1241 个文件的 SHA-256 全部与候选 site 一致，`admin-console.html` 存在；远端部署代码标记为 `187a054f3a64f08663581ac4de8ceb46d3661d08`。候选、部署前 393 与部署后 394 文件数均为 1241。
- `python3 artifacts/media-left-toolbar-20261024/verify-public.py`：公网 5 个页面版本一致，104 项静态资源 SHA-256 与候选一致；健康检查正常，访客访问管理页/私有接口仍被拒绝。
- `python3 artifacts/media-left-toolbar-20261024/verify-ui.py`：真实 UAT 页面，不覆盖任何资源或业务 API；两个页面 × 图表/案例共 4 组通过。检查左栏、图标名称/提示、画笔开关、放大镜、搜索/空结果/关闭、重置取消不丢知识点、图片放大/Esc、截图下载、案例滚轮与折叠展开；页面错误均为空。
- 根工作区重新同步后，与发布 checkout 的全部 1241 个生成文件逐字节一致。
- 正式环境仍为 `v9.0-p4.1.336`，运行镜像仍为 `sha256:8ff7068813ac25758c84dae5fdb941a0613af47b4b61824a1ba3ccd75dc7ee5e`；`main` 未合入或推送。

验收入口：UAT 首页“学习入口”→“深度回忆”或“多题归纳”→“新题型体验卷（图表·案例·连线）”。第1题检查图表左栏与放大，案例2检查案例阅读滚动。人工清单 P11–P14 均保留未勾选，等待老师本人确认。

证据位于 `artifacts/media-left-toolbar-20261024/`：`deploy.log`、`container.json`、`container-files.json`、`uat-public.json`、`uat.json`、`source.json`、`sync-equality.json`、`layout.log`、`materials.log` 及截图。首轮失败与独立复测日志一并保留，未掩盖失败记录。

## 后续正式发布

2026-10-24 老师明确回复“好的，部署到正式环境”，已授权当前UAT内容合入main并正式发布。现已完成v394正式上线；上文“未合main/等待验收”等描述为UAT交付当时状态。完整备份与上线核验见 [正式发布记录](2026-10-24-production-v394.md)。
