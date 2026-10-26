# PMP 第八版知识图谱内容包

包含 **30 套图谱、330 张卡片、342 条有说明的关系线**。其中有 210 张概念卡、30 张主题卡，以及 90 张情境自测、处理思路和易错辨析卡。

基于现有知识图谱编辑器制作，支持卡片详情、拖拽编辑、关系查看、闪卡复习和加载模板副本。没有新增题库绑定；情境自测为卡片阅读练习，不会自动判分。

## 查看与导入

- 本地服务：<http://127.0.0.1:5173/graph>。登录后点击“模板”查看、加载个人副本；库内部源文件不进入个人文件管理。
- `graphs/`：每套图谱一个原生 JSON，可用现有“导入学习包”导入。
- `packages/`：使用现有 `KGHomePackageService` 导出的 30 个 ZIP 学习包，每次选一个导入。
- `catalog.json`：主题目录、分类、布局和节点数量。
- `topics.txt`：原创内容源；`build.mjs` 调用现有图谱模型和学习包导出器生成文件。

重新生成并校验：`node 内置数据/PMP8知识图谱/build.mjs && node 内置数据/PMP8知识图谱/validate-layout.mjs`。

本地导入改为受保护的服务层入口，不再创建个人 imported 原件；必须使用后端虚拟环境并显式 `ENV=dev`，默认只读。旧 `--username` 保留，`--refresh-visuals` 已废止并明确报错。完整命令、旧 receipt 精确修复与新备份证据格式见 [共享发布说明](../shared/README-publication.md)。

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

该内容包已完成本地和 UAT 验证，用户已于 2026-10-25 确认并要求发布正式环境。UAT 记录见 `docs/verification/pmp8-foundation-uat/README.md`，正式发布记录见 `docs/verification/pmp8-foundation-production/README.md`。


## UAT 基础模板发布

`publish-uat.py` 是共享发布器的薄入口，默认只读 UAT，`--apply` 写入；正式环境必须显式 `--environment prod`。准确 ENV、配置与实际数据库均需匹配，远端入口拒绝 dev。已有同来源、owner、快照和当前源内容的出版物仅补 `pmp` 分类，不增加版本、不覆盖正文。原 catalog 的中文子主题保持原字节，由准确 packageId 映射到公共分类。

复制远端时必须同时复制兄弟 `shared/publication.py`；完整包目录布局、容器工作目录、备份纪律与可复制命令见 [共享发布说明](../shared/README-publication.md)。
