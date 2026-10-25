# PMP 第八版知识图谱内容包

包含 **30 套图谱、330 张卡片、342 条有说明的关系线**。其中有 210 张概念卡、30 张主题卡，以及 90 张情境自测、处理思路和易错辨析卡。

基于现有知识图谱编辑器制作，支持卡片详情、拖拽编辑、关系查看、闪卡复习和加载模板副本。没有新增题库绑定；情境自测为卡片阅读练习，不会自动判分。

## 查看与导入

- 本地服务：<http://127.0.0.1:5173/graph>。管理员登录后，在文件管理中打开 **PMP8 · 30套知识图谱** 文件夹，或点击左侧“模板”查看、加载副本。
- `graphs/`：每套图谱一个原生 JSON，可用现有“导入学习包”导入。
- `packages/`：使用现有 `KGHomePackageService` 导出的 30 个 ZIP 学习包，每次选一个导入。
- `catalog.json`：主题目录、分类、布局和节点数量。
- `topics.txt`：原创内容源；`build.mjs` 调用现有图谱模型和学习包导出器生成文件。

重新生成并校验：`node 内置数据/PMP8知识图谱/build.mjs && node 内置数据/PMP8知识图谱/validate-layout.mjs`。

本地导入：`python3 内置数据/PMP8知识图谱/import-local.py --username admin`，按提示输入本地密码。脚本只接受回环地址，经现有 API 创建个人文件与免费模板；遇到同名但已改变的图谱会停止，避免覆盖个人修改。它不会部署代码或连接 UAT/正式服务器。

对本轮已生成的本地图谱更新视觉：追加 `--refresh-visuals`。该模式先进行几何校验，再备份当前内容，只更新本轮文件的样式、位置与关系路径，保留卡片正文与个人学习状态，通过正式版本 API 发布模板新版本；已加载的个人副本保持独立。

## 内容组织

| 分类 | 数量 | 内容 |
| --- | ---: | --- |
| 总览 | 1 | 第八版知识导航 |
| 六项原则 | 6 | 整体观、价值、质量、担当、可持续性、赋能文化 |
| 七个绩效域 | 7 | 治理、范围、进度、财务、相关方、资源、风险 |
| 应用专题 | 14 | 变更、需求追踪、WBS、关键路径、压缩进度、挣值、完工估算、风险与储备、风险响应、沟通冲突、敏捷、看板、采购、收尾 |
| 扩展主题 | 2 | AI、PMO |

主题编号与详细内容以 `catalog.json` 为准。

每套图谱有主题入口、七张概念卡和三张应用卡。主题图使用双侧分支，把直接关联的知识点放在同侧相邻位置，具体关系从卡片外侧绕行；流程图沿带箭头的连续路径阅读，反馈关系走节点之间的空白区域。流程中的阅读顺序是教学安排，不声明为官方过程的强制依赖。原有的具体关系说明保留；相邻节点的重复关系合并，因此共 342 条连线。

配色沿用现有图谱：彩色图标、浅色卡面、统一轻边框。同组相关概念共用图标色，案例、处理思路和易错辨析分别以琥珀、青绿和玫红区分；根节点突出主题，普通节点不使用高饱和彩色粗框。

## 编排依据与范围

- [PMI：PMBOK Guide 第八版](https://www.pmi.org/standards/pmbok)：核对六项原则、七个绩效域，以及 AI、PMO、采购的扩展方向。
- [PMI：挣值管理基础](https://www.pmi.org/learning/library/earned-value-management-systems-analysis-8026)：核对 EV、PV、AC、CPI、SPI 的基本含义与关系。
- [PMI：TCPI](https://www.pmi.org/learning/library/to-complete-performance-index-tcpi-6009)：核对按 BAC 与获批 EAC 目标计算剩余效率的差别。
- [PMI：挣值实践](https://www.pmi.org/learning/library/make-earned-value-work-project-6001)：核对完工预测及其适用假设。
- [PMI：关键路径](https://www.pmi.org/learning/library/critical-path-scheduling-work-breakdown-6212)：核对关键路径、工作分解与进度压缩的联系。
- [Scrum Guide](https://scrumguides.org/scrum-guide.html)：核对迭代目标、范围协商、评审与回顾等敏捷实践。Scrum 是应用示例，不代表全部敏捷方法。

核对日期：2026-10-25。内容为原创中文学习说明与案例，非 PMI 官方译文、官方试题或考纲完整映射。PMBOK 第八版知识框架与 PMP 考试大纲分开理解；这里没有把“人、过程、商业环境”当作第八版七个绩效域。

该内容包已完成本地验证；UAT 发布与验收状态见 `docs/verification/pmp8-foundation-uat/README.md`。未经用户 UAT 验收通过，不合入 main 或发布正式环境。


## UAT 基础模板发布

`publish-uat.py` 只针对 `ENV=uat` 且数据库为 `kg_graph_uat` 的运行后端，通过现有文件与模板服务创建免费、已上架的基础模板，维护来源为管理员 `admin`。默认执行只读计划，明确传入 `--apply` 才会写入。

发布前先备份 UAT 当前代码、运行资产与数据库，校验备份非空且可读取，再将 `catalog.json`、`graphs/` 与该脚本传到 UAT 后端的临时包目录。该操作不需要重建镜像或重启服务。

```text
python /tmp/pmp8-foundation/publish-uat.py --report /tmp/pmp8-foundation/plan.json
python /tmp/pmp8-foundation/publish-uat.py --apply --report /tmp/pmp8-foundation/published.json
```

已有同一批次且内容相同的模板会复用；名称、归属或内容冲突会中止，不覆盖已有模板。模板更新不会修改学员已加载的副本。
