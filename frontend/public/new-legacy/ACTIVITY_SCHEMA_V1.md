# Activity Schema v1

v8.6.0.3 完成 Activity Schema v1 的第一阶段收尾。当前原则是：**中文负责作答与判定，英文只作为可选展示内容**。

## 架构边界

```text
Question Studio 草稿／导入包
          ↓
统一活动库（唯一正式内容来源）
          ↓ activityIds
课程 → 阶段 → 部分 → 节点
          ↓
学员端运行器
```

- `course.nodes[*].activityIds` 只保存活动引用，不复制题目正文。
- `course.activities` 保存规范化 Activity Schema v1 活动。
- 活动 `type` 是唯一权威类型；运行器类型和兼容适配器由程序推导。
- 正确答案与显示文字分离，使用稳定的 `optionId`、`segmentId`、`itemId`、`pairId` 或概念 ID。
- 旧中文题库启动时确定性迁移，活动 ID 和课程节点引用保持不变。

## 核心记录

```json
{
  "id": "env-choice-01",
  "type": "single_choice",
  "schemaVersion": 1,
  "content": {
    "zh": {
      "stem": "……",
      "options": [{"id": "A", "text": "……"}]
    },
    "en": null
  },
  "answer": {"optionId": "A"},
  "explanation": {
    "zh": {"short": "……", "detailed": "……", "incorrect": "……", "general": "……"},
    "en": null
  },
  "assessment": {"language": "zh"},
  "config": {},
  "metadata": {
    "adapter": "single_choice",
    "runtimeType": "choice",
    "source": "guided-learning-legacy",
    "translationStatus": "zh_only"
  }
}
```

`content.en` 和 `explanation.en` 必须保留字段；尚无英文时显式写为 `null`。中文内容为必填项。

## 展示语言与判定语言

学员端只开放两种显示方式：

- `zh`：只显示中文；
- `bilingual`：中文和英文对照显示，英文缺失字段逐项回退中文。

学员端不开放纯英文按钮。旧浏览器中若保存过 `en`，进入答题页时会自动转换为 `bilingual`。

无论显示方式如何，当前版本始终使用：

```json
{"assessment": {"language": "zh"}}
```

因此：

- 单选、排序、连线和翻牌仍按稳定 ID 判定；
- 关键词与开放表达只使用中文判定规则；
- 英文关键词、英文同义词和英文开放表达评分暂不运行；
- 数据层仍保留纯英文物化能力，供未来教师预览或后续扩展使用。

## 第一阶段标准活动类型

已具备专用结构、校验和兼容运行器：

- `single_choice`：单项选择；
- `keyword_recognition`：关键词识别；
- `ordering`：独立排序；
- `matching`：连线配对；
- `open_response`：开放表达；
- `memory_match`：翻牌记忆。

深度回忆、多题归纳、知识图谱和综合挑战继续由兼容适配器运行，后续再开发专用可视化编辑器。

## 类型权威规则

`type` 决定运行器和适配器。导入数据若同时提供 `metadata.adapter` 或 `metadata.runtimeType`，它们必须与 `type` 一致，否则阻止导入。未知类型和拼写错误不会再被当作兼容活动静默接受。

## 校验规则

运行时校验器与 JSON Schema 共同检查：

- 稳定活动 ID、`schemaVersion`、中文内容和中英文槽位；
- `assessment.language` 必须为 `zh`；
- 题型所需字段、稳定子项 ID、答案引用、数量与顺序；
- 中英文选项、分段、排序项或配对项的 ID 对齐；
- `translationStatus` 只允许 `zh_only` 或 `bilingual`；
- 活动库键名与活动内部 ID 一致；
- 活动包版本、时间、内容哈希、重复 ID 与同 ID 冲突。

JSON Schema 文件：

- `schemas/activity-schema-v1.json`
- `schemas/activity-package-v1.json`
- `schemas/activity-schema-v1.example.json`
- `schemas/activity-schema-v1.ordering.example.json`

## 活动包与合并接口

```javascript
KGActivitySchemaV1.createPackage(library, metadata)
KGActivitySchemaV1.validatePackage(payload)
KGActivitySchemaV1.parsePackage(jsonOrObject)
KGActivitySchemaV1.analyzePackageMerge(existingLibrary, payload)
KGActivitySchemaV1.mergePackage(existingLibrary, payload, options)
```

合并分析会区分：

- 新活动；
- 内容未变化；
- 同 ID 内容冲突；
- 不同 ID 但内容相同。

冲突策略支持：

```text
reject          默认，拒绝冲突
keep_existing   保留现有活动
replace         使用导入活动替换
```

`contentHash` 用于离线传输完整性检查，不是数字签名或安全认证机制。

## 旧数据兼容

- 现有旧题库由迁移器生成规范 Activity Schema v1。
- v8.6.0～v8.6.0.2 导出的早期 v1 活动若缺少 `assessment`，导入器会补为 `{language: "zh"}` 后再校验。
- 新生成的数据必须满足当前严格 Schema；兼容逻辑不会放宽新文件的输出标准。

## 自由模式中的英文展示

v8.6.0.4 将同一显示规则扩展到自由模式：

- 多题画布和深度回忆提供“中文 / 中英对照”；
- 英文只参与渲染，不参与选择、关键词、开放表达或进度判定；
- 中英文内容共享稳定 optionId、itemId、pairId、segmentId 或知识节点 ID；
- 页面切换语言时只重新渲染文字，保留当前画布、选择和回忆路径状态；
- 英文缺失时按字段回退中文，不阻止中文活动运行。

Question Studio v0.1.0 生成的活动始终包含：

```javascript
assessment: { language: "zh" }
```

因此录入英文题干、选项或解析不会意外开启英文判题。

## v8.6.1：科目、知识树和作者追踪扩展

活动内容结构保持 Activity Schema v1，不增加第二套题库。活动在 `metadata` 中增加可选的内容管理信息：

```javascript
metadata: {
  subjectId: "subject-pmp",
  knowledge: {
    taxonomyId: "taxonomy-pmp-main",
    taxonomyVersion: 1,
    primaryNodeId: "kp-pmp-rtm-bidirectional",
    relatedNodeIds: [],
    mappingStatus: "confirmed",
    pathSnapshot: ["PMP", "项目需求管理", "规划需求管理", "输出", "需求跟踪矩阵", "双向可追溯特点"]
  },
  authorship: {
    createdByUserId: "teacher-001",
    createdByName: "张老师",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedByUserId: "teacher-001",
    updatedByName: "张老师",
    updatedAt: "2026-07-21T00:00:00.000Z"
  }
}
```

正式关联以稳定 ID 为准，`pathSnapshot` 只用于离线查看和版本诊断。每个普通活动使用一个主知识点，可选多个相关知识点。历史活动可以暂时使用 `mappingStatus: "unmapped"`。
