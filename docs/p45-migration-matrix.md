# P4.2–P4.5 源码到数据库迁移矩阵

本清单是 P4.2–P4.5 的逐批迁移边界。业务数据以 PostgreSQL 为唯一持久化真值；浏览器只能保留页面内存以及不含业务内容的短生命周期导航/预览令牌。

每一批只可从 `updata-legacy/` 提取下表明确列出的模块、样式和页面。禁止直接覆盖 `new-legacy/`、`frontend/public/new-legacy/` 或 active release；发布只能通过 `frontend/scripts/manage-new-legacy.js update`，并在 promote 前完成文件数量、关键页面、API 和视觉回归验证。

## 批次顺序

1. 数据库持久化护栏、兼容键和本迁移矩阵。
2. 题库、分类和训练配置。
3. 画布运行时与图谱编辑器。
4. 做题与试卷闭环。
5. 深度回忆与联想库。
6. 学习诊断与推荐基础。
7. Prep Studio 与外部 AI 契约。

## 功能归属

| 功能组 | 来源模块 | 目标页面 | PostgreSQL 归属 | API | 排除？ | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| 图谱画布 | `src/graph/*`、`src/canvas/*`、`src/10-graph-editor.js`、`src/23-graph-file-store.js` | 首页图谱编辑器 / `workbench.html` | `graph_files`、`file_contents` | `/api/v1/files` | 否 | 文件/正文 API 回归；登录后跨设备重新打开同一图谱；legacy 与目标页视觉对比 |
| 题库与训练 | `src/teacher/question-bank/*`、`src/teacher/training-config/*`、`src/principles/*`、`src/60-question-bank.js` | `question-bank.html`、`training-config.html` | `question_banks`、`questions`、`question_tag_configs`、`subject_facet_schemas`、`principles`、`synthesis_presets` | `/api/v1/question-catalog`、`/api/v1/content-prep` | 否 | 题库/标签/科目分类/原则/归纳卡 API 回归；训练配置刷新后仍从关系表读取 |
| 做题与验证 | `src/practice/*`、`src/100-practice-mode.js`、`src/103-practice-verification-service.js`、`src/104-practice-learning-orchestrator.js` | `practice-mode.html`、`question-training.html` | `learning_events`、`practice_mistakes`、`practice_verifications` | `/api/v1/learning` | 否 | 尝试、错题、补救、验证证据和学习记录 API 回归；清理浏览器数据后学习记录仍可读取 |
| 深度回忆 | `src/86-knowledge-recall.js`、`src/97-recall-storage.js`、`src/98-recall-graph-model.js`、`src/95-recall-association-library.js`、`src/admin/53-recall-association-management.js` | `knowledge-recall.html`、联想库管理页 | `recall_progress`、`shared_runtime_states`；计划：`recall_association_libraries` | `/api/v1/training`、`/api/v1/content-prep` | 否 | 回忆进度与联想发布 API 回归；发布历史、容量预检和事务失败不留下半成品 |
| 学习诊断与推荐 | `src/learning/diagnosis/*`、`src/learning/content/*`、`src/teacher/learning-content/*`、`src/87-guided-learning-data.js` | `learning-path.html`、教师学习内容工作区 | `learning_evidence`、`learning_diagnoses`、`learning_decisions`、`learning_content_versions`、`content_eligibility_policies`、`recommendation_candidates`、`recommendation_rankings`、`recommendation_selections`、`recommendation_records`、`learner_content_events`、`content_effect_attributions` | `/api/v1/learning` | 否 | 证据、诊断、候选、排序、选择与消费事件 API 回归；首期不自动向学员推送 |
| Prep Studio | `question-studio/*`、`src/teacher/shared/external-ai-question-authoring-contract.js`、`src/teacher/question-bank/question-family-compatibility-core.js` | Prep Studio / `content-prep` | `question_upload_batches`、`question_audit_logs`、`prep_workspaces`（计划） | `/api/v1/content-prep` | 否 | 批次上传、审计、锁和题库读取 API 回归；正式草稿不使用 IndexedDB |
| 四个学习入口 | 无（不得从 updata-legacy/ 复制） | 首页 | — | — | excluded | 不建立 source-copy 任务；首页回归确认入口未出现 |
| 新手引导 | 无（不得从 updata-legacy/ 复制） | 首页 | — | — | excluded | 不建立 source-copy 任务；首页回归确认引导未出现 |
| 简易/专业知识点编辑切换 | 无（不得从 updata-legacy/ 复制） | 首页图谱编辑器 | — | — | excluded | 不建立 source-copy 任务；首页回归确认切换未出现 |
| 帮助入口改版 | 无（不得从 updata-legacy/ 复制） | 首页 | — | — | excluded | 不建立 source-copy 任务；首页回归确认改版入口未出现 |

## 排除项护栏

四个首页能力（四个学习入口、新手引导、简易/专业知识点编辑切换、帮助入口改版）仅作为 `excluded` 行存在：没有源码复制任务、没有数据库归属、没有 API 路由。任何后续批次都不得把这些能力从 `updata-legacy/` 带入目标页面。

## 首批验收

首批仅建立持久化护栏和本清单，不替换页面行为。提交前必须运行后端运行时状态、Content Prep 模型和 Question Catalog 测试，以及 P4.5 持久化契约、同步契约与直接运行时测试。已知因被忽略的外部 `enterinformation/` 目录导致的 `new-legacy-release.test.mjs` 失败不属于本批；不得为掩盖该失败而修改 release 输出或 updater 源码。
