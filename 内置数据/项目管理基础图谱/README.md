# 项目管理基础图谱（18 套）

依据官方公开框架编排的原创入门学习内容，每个分类 6 套，每套 11 张卡片（主题、7 个概念、情境自测、处理思路、易错辨析）。共 198 张卡片、198 条含说明的连线。不是官方试题、教材节选、完整考试大纲或资格判断工具。

| 分类 ID | 专题 |
|---|---|
| prince2 | 方法框架与五个整合要素；七项原则；七项实践；七个过程；角色与治理职责；阶段管理与例外升级 |
| cspm | 能力评价框架与等级；目标范围与工作分解；进度资源与执行控制；风险问题与变更；沟通协作与职业行为；经验教训与能力证据 |
| gaoxiang | 信息系统项目知识导航；立项论证与整体管理；需求范围与验收；进度成本与挣值；风险质量与采购协同；案例分析与论文结构 |

## 来源与范围

资料核对日期：2026-10-26。`topics.mjs` 是原创内容源，`graphs/` 是规范 KGGraphModel 输出，`packages/` 是现有 KGHomePackageService 生成的学习包。引用 URL 同时保存在每张图谱的 `meta.sourceUrls` 与目录中。

- [PeopleCert：第七版演进](https://www.peoplecert.org/news-and-announcements/PRINCE2%207%20-%20A%20Process%20of%20Evolution)、[第七版新增内容](https://www.peoplecert.org/news-and-announcements/Prince2-7-new-chapter)：五个整合要素、人员、实践、过程、裁剪及可持续性。第七版使用“实践”，过程不是强制七步单线；指导贯穿项目，阶段控制与产品交付交互，阶段边界可重复。原则必须体现，裁剪改变应用方式。预测超出容限即升级。
- [国家标准 GB/T 41831-2022](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=60CBF52A6990CA339456106CE7AD43F9)、[五等级说明](https://cspm.china-cas.org/gyks/366.jhtml)、[CSPM-2 2026 大纲](https://cspm.china-cas.org/u/cms/www/202601/13141543wnsq.pdf)：标准是能力评价依据，五等级不是生命周期。教学深度参考初级大纲，明确成本、采购、变更、经验教训等领域与应用分析领域的要求差异；不外推所有等级规则。标准四维度与大纲分组口径不同，内容避免将栏目数机械等同。
- [清华大学出版社第四版教程](https://www.tup.com.cn/booksCenter/book_09983002.html)、[官方考试通知转发](https://gxt.fujian.gov.cn/zwgk/ztjj/fjrkzl/xxfb/ksxx/202303/t20230310_6128921.htm)：教程 ISBN 9787302624318，出版于 2023 年；信息系统技术、治理、工程、配置变更等属于知识版图。案例和论文结构是原创学习策略，不是官方固定评分公式，不宣称存在“2026 新版教材”。

情境、数字、处理思路和连线说明均为原创。挣值案例统一以万元计：PV=10、EV=8、AC=9，SV=-2、CV=-1、SPI=0.8、CPI=8/9，表示进度落后且成本效率不足。EAC=BAC/CPI 明确限定未来效率沿用当前表现的假设。

## 生成与只读验证

在仓库根目录执行：

```sh
node 内置数据/项目管理基础图谱/build.mjs
node 内置数据/项目管理基础图谱/validate-layout.mjs
node --test 内置数据/shared/authoring.test.mjs
python3 -m unittest discover -s 内置数据/shared -p 'test_*.py' -v
```

共享作者工具位于 `内置数据/shared/`，复用既有双侧/引导流程布局及编辑器真实端口和贝塞尔路径。新图全部采用双侧主题分支，不表达过程时序；概念关联放在外侧独立通道。几何校验使用真实编辑器路径采样，检查非端点卡片遮挡和线段相交；并验证全部 48 套图及 ZIP、连通性、内容与哈希。

`catalog.json` 保留既有发布器所需的 `graphs/id/name/file/nodeCount/linkCount/description` 字段；新增稳定 `packageId`、每行 `category`、`sourceKey`、图文件 `sha256`、`packageFile` 与 ZIP `packageSha256`。sourceKey 为 packageId + ':' + topicId。新内容包不借用旧 PMP ID。学习包沿用现有导出器的实际导出时间，因此重新生成 ZIP 后应一并保存更新的目录 ZIP 哈希；图文件哈希稳定。不要为验证而重建旧 PMP ZIP。

当前目录不执行数据库导入或远端发布。分类、库源文件创建与安全旧源修复由独立服务层发布工具负责。严禁通过客户端 API 绕过保留的 builtin-template source 限制。
