# 练习入口加载反馈与多题归纳按需取题设计

## 目标

1. 用户从学习记录点击“进入练习模式”时立即看到统一加载框，重复点击不会重复创建练习。
2. 进入多题归纳时不再拉取所有已发布试卷的全部题目，只加载当前选中试卷；切换试卷后再加载目标试卷。
3. 同一 release 的并发题目请求共用一个进行中的请求，避免重复分页。

## 当前问题

- `startPractice('practice')` 没有使用挑战模式已有的 `KGLearningLoading` 和进入中保护。
- 多题归纳用 `KGPublishedQuestionResolver.listPapers()` 构建试卷下拉；该接口会解析每个 release，因此入场时产生多组 `/paper-releases/{releaseId}/questions` 分页请求。
- `KGPaperReleaseApi.fetchQuestions()` 只缓存完成结果，没有缓存进行中的 Promise；题库兼容预取与页面加载并发时，同一 release 会重复请求。

## 设计

所有加载反馈统一复用现有的 `KGLearningLoading` 单例组件，只调用其 `show()` / `hide()`；不新增第二套加载 DOM、样式或组件实现。

### 练习入口

- 扩展练习模式已有的单一进入中状态，使 `practice` 与 `challenge` 共用防重复逻辑。
- `practice` 展示“正在进入练习模式 / 正在读取试题…”，`challenge` 保持现有文案。
- 成功、失败都关闭加载框；失败后焦点回到入口按钮，允许重试。

### 多题归纳

- 下拉目录只从 `KGPublishedPaperRepository.listCatalogEntries()` 读取轻量摘要。
- 根据 URL、已保存选择或首份可用目录确定当前 release，然后只调用一次 `resolvePaper()` 加载它的题目。
- 切换试卷时重新解析选中的 release；未选中的 release 不请求 `/questions`。
- 首次解析当前试卷和切换试卷时都使用 `KGLearningLoading` 展示“正在加载试卷 / 正在读取试题…”。
- 加载期间忽略重复切换；加载失败时关闭加载框、保留原试卷和题目，并允许重试。
- `fetchQuestions()` 以 release、seed 和 maxCount 组成请求键，缓存进行中的 Promise；请求结束（成功或失败）后清除该键，完成缓存仍按现有规则复用。

## 边界

- 不修改管理端页面或发布管理行为。
- 不恢复 `/api/v1/runtime/state`。
- 不改变已发布试卷的权限、会员、模式和冻结快照校验。
- 前端权威源仍为 `new-legacy/`，适配层仍为 `frontend/scripts/new-legacy-assets/`。

## 验收

- 练习入口加载框可见，重复进入只触发一次解析，失败可重试。
- 多题归纳初始化有 N 份目录时，只请求当前 release 的 `/questions`，并显示加载框；切换后显示加载框且只新增目标 release 的请求。
- 切换加载失败后仍保留此前已加载的试卷和题目，用户可再次选择重试。
- 两个同时发起的相同 `fetchQuestions()` 只产生一组分页请求，并获得等价结果。
- 相关定向测试、前端全量契约与正式 release 更新校验通过。
