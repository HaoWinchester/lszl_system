# 个人学习工具反馈 — UAT 340

用户授权：大厅暂不改，其余已澄清需求实施。大厅 body/header 已与 b76862ed 逐字比较，相同；没有执行延后的去科目/大厅重设计。范围包括分享元信息与 /graph、模板图形预览、图谱工具条与关系线、共享画布文字/画笔、独立答题视图。

## 当前交付状态

- 开发分支：codex/learning-tool-feedback；原 main/uat 基线 b76862ed。
- 候选版本：v9.0-p4.1.340，正式管理脚本 update new-legacy --skip-browser 生成；候选完整保留 v336 的1138个文件，新增5个（共1143），admin-console 等关键页均存在。
- 逐任务审查与全分支审查均通过。审查中修复了：折线正文选段、13点完整渲染与保存重开、模板预览/加载版本竞争、超大整数、canonical 卡片尺寸/标题/配色。
- v339 首轮完整门禁：后端1072、前端336及答题流程通过；画布图谱测试发现新增中点与旧控制点索引重复，门禁中止，未部署。已补修06c34e73，保留旧0/1控制点、中点用2；整组图谱9 sections与配题/思维导图/反馈浏览器及36 Node复查通过，独立审查通过。
- v340 完整发布门禁全部通过：后端1072、前端336、扩展契约10、官网/权限/续练/答题/31画笔/整组图谱/配题/跨页面/学习资产/视觉回归通过。生成 runtime 时出现一次本地 ENOTEMPTY；已确认遗留157个文件均为 release 中相同副本后清理，重新执行官方 prepare-runtime 成功。UAT 部署及公网冒烟已通过；用户业务验收尚待本人确认。没有合入或推送 main。

## 已验证

- 前端全量：336 Node 包装契约、9 Python 契约、4 UAT 部署脚本套件；design5项。源修改后最终前端再次全量运行。
- 后端最终全量：1072通过，3条现有依赖弃用提示；canonical/大整数投影等模板9项定向检查通过。
- 图谱：真实 Chrome 短拖/中点/折线段/端点解绑、单次撤销与取消、重叠线切换、四方向布局、主题/撤销、多选框工具栏、缩放/全屏；完整 sanitizer/storage/hydrate 转折点往返。
- 缩放实测：300卡/120帧，选中元素查询120→1、装饰写入1200→600；卡牌重建均0、P95均16.8ms。只确认工作量减少，不声称帧率提高。
- 模板真实 API+浏览器：缩略图、详情、平移、缩放、适应、窗口拖动、全屏、390px、关闭重开、失败重试、加载独立副本、不改源、列出v1后更新v2时加载v2；canonical600×80卡片保留尺寸。投影不含 notes/题目答案/资源 URL，身份/下架/会员加载限制沿用。
- 答题：1440/1024/768/390圆形浮动入口、文字不截断、默认收起、打开/关闭/跳题/焦点/交卷；四模式保存/续练/冲突与失败重试、即时反馈回归。
- 共享画布：27单元、2包装、31真实 API 浏览器检查；图谱/回忆/多题文字自然高度、删行、编辑态拖动选区、保存失败恢复与重载；临时空白绘画/文字/右键/X、只读及无正式写入、稳定卡片 hover。
- 分享：metadata无做题/刷题字眼；/graph直接200、参数保留、bootstrap 与页面权限测试通过；官网现有做题入口保持。

## 验证范围限制

真人 macOS 输入法候选窗口未覆盖，IME 状态使用合成 composition 事件；Safari/各DPR/超大图主观清晰度未量化。自动化开发自检不代替用户 UAT 业务验收。

证据日志与截图：artifacts/learning-tool-feedback/，以及 task-2-report.md 所列现有画布 artifacts。测试使用独立临时 PostgreSQL，不向生产写测试数据。

## UAT 实际部署与公网核验

- 环境：https://uat.aihuanpu.com ，实际版本 **v9.0-p4.1.340**。部署脚本 exit0，完整门禁耗时1159秒；缓存相同证明后重试 runtime/部署耗时105秒。
- 实际部署代码提交：`c1c8c80f7b3ff9be8cf2605403cf73c72244c2fd`，远端 `.deploy-state/git-commit` 已核对一致。后续验证记录提交仅修改文档。
- 公网六页（/、/graph、/index.html、/practice-mode.html、/knowledge-recall.html、/question-workspace.html）均200且版本340。`/graph` 无重定向，浏览器地址保持 /graph，bootstrap.page 为index.html；分享标题为个人学习工具。
- 公网四项资源与本地 immutable site SHA256逐一相同：home-graph bundle、answer-page.css、94-canvas-ink.js、template-preview.js。真实 Chrome 游客图谱/大厅无 pageerror，截图与JSON证据见 artifacts/learning-tool-feedback/uat-public-smoke.*。
- 29条运行路由、13张必要表、教师助手worker、转换器及历史试卷回填检查通过；HTTPS健康、PUBLIC_RELEASE_OK均通过。
- 永久分支 main/uat 均存在；main仍为b76862ed。当前停止在UAT等待用户业务验收，未将自动化通过当作业务验收。
