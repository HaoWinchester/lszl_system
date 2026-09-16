# 2026-09-16 历史 release 回退审计（独立复核）

## 范围与结论

审计比较以下本地不可变 release 的 `source/` 与 `mini-spekra-growth/new-legacy/`，检查文件缺失并阅读有业务意义的差异，重点为 comments、practice、auth、teacher、content-prep。除本报告外，本审计未修改代码。

- 根工作区 `frontend/new-legacy-releases/v9.0-p4.1.212/source`。
- `prod-practice-v216` 工作树的 `.206/.216/.217/.219/.220/.224/.225/source`。
- 当前候选：`mini-spekra-growth`，审计开始时 HEAD `10665c5`；主任务可在审计期间继续修复，因此下述退款状态为报告写入时再次读取的结果。

**结论：发现的历史能力遗漏是退款条款、题目讨论/弹幕，以及题目 API 返回 401 时自动打开登录框。当前候选已覆盖这三项；本次逐项审查没有找到除此之外仍需恢复的历史功能证据。** 这不是所有新功能都没有 bug 的保证，也不代表正式站点已部署。

## 必须按真实时间解释版本

| 本地 release | release.json createdAt（UTC） | 有效源文件数* |
| --- | --- | ---: |
| prod 工作树 .206 | 2026-09-02T05:57:32.928Z | 946 |
| prod 工作树 .216 | 2026-09-06T13:20:43.858Z | 948 |
| prod 工作树 .217 | 2026-09-08T02:45:55.617Z | 948 |
| prod 工作树 .219 | 2026-09-08T08:31:58.112Z | 948 |
| prod 工作树 .220 | 2026-09-09T00:26:12.700Z | 948 |
| prod 工作树 .224 | 2026-09-09T01:48:48.714Z | 948 |
| prod 工作树 .225 | 2026-09-12T02:28:00.438Z | 951 |
| 根工作区 .212 | 2026-09-13T15:15:39.163Z | 见 release 清单 |

\* 比较脚本排除 `.DS_Store`、`.pytest_cache`、`__pycache__`，因此与 release.json 原始 sourceFiles 口径不同。发布时不得拿此表替代原始文件数硬校验。

`.212` 比 `.225` 实际创建得更晚，不能根据编号推断 `.216`、`.225` 发布时删除了 `.212` 的功能。`.225` 的本地 current.json 指向 `.225/site`，promotedAt 为 2026-09-12T02:28:00.476Z，但这只是历史工作树状态，不足以证明当前正式机器的 active release。

以上初始范围（根 `.212` 与 prod 工作树列明的八组 release）内的有效文件在当前候选均仍存在，没有发现整页、共享模块或内容准备源文件丢失。该结论不包括后续追加核查的独立 UI 分支 `.211`；其四项差异见文末补充。根 `.212` 中消失的文件仅为操作系统或测试缓存。

## 已识别遗漏及候选覆盖

### 1. 退款 1.1 条款

- 历史依据：根 `.212/source/terms-of-service.html:2`，版本 1.1，生效日 2026-09-12；含累计不足 100 题全额、100 至不足 150 题退 20%、150 题及以上不退款，以及人工原路退款与每订单一次申请说明。
- `.206/.216/.217/.219/.220/.224/.225` 的对应 source 全部是版本 1.0，仅笼统提及退款，没有具体规则。
- 候选审计开始时同样为 1.0。Git `log -- new-legacy/terms-of-service.html` 最后记录为 `684e16b`（2026-08-15），说明此分支未继承该 9 月条款，而非可以从当前分支找到一次近期删除条款的提交。
- 最小恢复：只恢复 1.1 版本/生效日及具体退款规则，保留现有页面结构；同步小程序法律内容。
- 写报告前复核：当前候选 `new-legacy/terms-of-service.html:2` 已包含 `版本 1.1` 及 `150` 规则。小程序的最终内容/包与发布状态由主任务另行核验。

### 2. 题目讨论与弹幕

- `.212` 有 `src/119-question-comments.js`、`styles/question-comments.css`、`tests/question-comments-browser.py`；`.225` 缺少这三项，练习与报告也没有对应挂载点。
- 当前候选共享评论 JS 与 `.212` 仅空白差异，CSS 仅空白差异，原有讨论、点赞、删除、弹幕挑选行为没有被替换。
- 候选入口已覆盖：
  - `new-legacy/practice-mode.html:14` 加载评论 CSS；`:364` 加载共享评论 JS。
  - `new-legacy/src/100-practice-mode.js:614` 在解析区调用 `KGQuestionComments.mountPanel`。
  - `new-legacy/src/113-practice-result-report.js:115` 起对报告题卡调用 `mountCards`；“回顾全部”也走 `selectWithComments`，比历史遗漏的重新挂载更完整。
  - `new-legacy/src/119-question-comments.js:57` 保留 `pickDanmaku`，`:274`/`:283`/`:296` 保留各挂载入口。
- 此恢复已在候选 `2ad435c` 中。不要从 `.225` 重新覆盖这些文件或恢复整个旧答题页。
- 正式站点只读核实：主任务已读取正式资源，`artifacts/refund-production-readonly.json` 显示练习页缺少两项评论资源引用；当前正式尚未覆盖，本候选待部署。独立审计未接触线上修改。

### 3. 401 登录弹窗

- 根 `.212` 两个共享登录模块都监听 `kg:auth-required`；`.225` 对应代码没有该监听，因此适配器发出事件时页面不会自动提示登录。
- 当前候选与 `.212` 的此处差异只是注释/空白，监听和三秒节流逻辑保留：
  - `new-legacy/src/30-shared-auth-dialog.js:268`。
  - `new-legacy/src/30-standalone-auth-dialog.js:193`。
- 当前适配器仍发出事件：`frontend/scripts/new-legacy-assets/practice-learning-adapter.js:42`、`question-catalog-adapter.js:40`，另有 paper-release、paper-draft、personal-card。
- 此恢复已在候选 `2ad435c` 中。正式恢复必须包含两类共享模块及匹配适配器，不能只测练习页。
- 注意该监听会在 `isLoggedIn()` 为真时返回；本报告证明历史监听恢复，不保证所有服务端会话失效时序都已由浏览器验证。

## 有差异，但不应当作回退恢复

- `src/100-practice-mode.js` 删除 `seededShuffle/questionsShuffled`：提交 `f377b60` 明确修复随机题序重复洗牌，后端 `backend/app/services/practice_session_service.py:149` 与 `:746` 冻结随机题序，前端按冻结题序与 `currentIndex` 恢复。恢复旧前端洗牌会再次造成题序/位置不一致。
- 做题入口要求登录、访客仍可看到目录及登录入口，以及“最新试卷”标签：对应 `558329f` 等后续改进，不能恢复为访客本地练习路径。
- `src/29-auth-core.js`、`src/32-wechat-login.js`、`src/33-user-center.js` 新增微信首次绑定已有账号、注册后提示绑定与找回原账号流程：对应 `e150815` 的账户关联修复，历史密码登录与现有扫码入口保留。
- 图谱保存/退出：新增等待异步保存、并发 revision 获取、首次创建和防重复创建、仅缩放预览不建文件；这些是后续持久化修复，没有发现为了新功能移除历史保存入口。
- practice 的配对题/材料/案例，teacher 的混合试卷和案例整组增删移动，content-prep 的配对结构保留：属于后续题型扩展。原单选/多选处理仍在。没有将整个 teacher/content-prep 文件回滚的理由。
- 答题页导航、标记筛选、材料栏与样式：`487c7f2` 等设计更新。历史 DOM 业务入口仍在，不能将 `.211` 或旧 `.212` 整页覆盖来“恢复视觉”。

## 只读线上核对清单（交主任务）

读取正式域名以下资源即可确认，不需发送留言、点赞或更改任何用户数据：

| 路径 | 应看到的候选特征 |
| --- | --- |
| `/terms-of-service.html` | 版本 1.1、150、20%、每订单一次退款 |
| `/practice-mode.html` | question-comments.css、119-question-comments.js |
| `/src/119-question-comments.js` | pickDanmaku、mountPanel、mountCards |
| `/src/100-practice-mode.js` | KGQuestionComments?.mountPanel |
| `/src/113-practice-result-report.js` | KGQuestionComments.mountCards |
| `/src/30-shared-auth-dialog.js` | kg:auth-required 监听 |
| `/src/30-standalone-auth-dialog.js` | kg:auth-required 监听 |

若线上没有上述特征，标为“候选已修，正式待发”；不能用本地 `current.json` 或源文件存在宣称线上修复成功。

## 正式只读核实补充

主任务提供 `artifacts/refund-production-readonly.json`，本审计已读取其内容：四个资源均 `fetched: true`；正式条款未出现版本 1.1 / 累计做满 150，练习页没有评论样式与脚本引用，两类共享登录 JS 均没有 `kg:auth-required`。故状态由“待线上核实”更新为 **候选已恢复、正式资源仍缺，待发布后复核**。此证据是源码标记检查，不是线上浏览器交互或后端评论 API 的验证。

## 验证证据与限制

执行于候选工作树：

```sh
node --test new-legacy/tests/practice-seeded-shuffle.test.js new-legacy/tests/practice-marked-answer-sheet.test.js new-legacy/tests/mixed-practice.test.js new-legacy/tests/mixed-question-editor.test.js new-legacy/tests/practice-answer-attempt.test.js
```

结果：17 项通过，0 失败。覆盖服务端冻结顺序契约、标记答题卡、匹配判定与草稿、案例整组编辑、content-prep 配对校验、独立答题重试身份。

本审计未运行跨页面浏览器登录/退出遍历、线上评论交互、完整前后端测试或小程序真机测试；这些结论不得替代 UAT 业务验收。未修改功能代码，未发布、推送或更改正式环境。


## 本次未提交修复的独立代码复核

复核范围：`manage-new-legacy.js` 协议 gate、release/cache 契约测试、未跟踪的 `frontend/scripts/legal-documents.test.mjs`、PC 条款恢复、小程序法律生成物及测试。未修改任何功能代码或测试。

- PC 条款与根 `.212/source/terms-of-service.html` **逐字节一致**。
- `node miniprogram/scripts/sync-legal-documents.mjs --check` 通过；小程序正文与源的 hash/生成物一致。
- 按项目 TypeScript strip-types 参数运行 PC + mini 法律测试，**4/4 通过**。第一次未加 `--experimental-strip-types` 的直接 Node 调用因 Node 22.11 不识别 `.ts` 而失败；使用项目规定参数后通过，非代码缺陷。
- 新协议 gate 先于缓存返回和 `--skip-browser` 返回执行；validator hash 包含 manager 及新测试，未发现沿用旧缓存而绕过新规则的路径。默认 update 和 UAT 部署中的 update 均会执行 gate。
- 当前条款/隐私文档结构均满足解析约束；正文提取忽略标签与空白，因此同步层注入资源标签不会制造内容变更误报。
- **无阻塞产品问题。低优先级测试问题**：`frontend/scripts/new-legacy-release.test.mjs` 中 `same-version-missing-refund` 实际替换的是“会员套餐…”段，而没有删除“退款说明…”段；其确实覆盖同版本正文变化拦截，但名称对应的退款删除场景不准确。建议在完整验证结束后将 mutation 改为删除退款段并断言确实删除，或改名。
- 边界：独立 `promote` / `rollback` 命令沿用既有实现，未经过此 gate；当前正式/UAT 标准脚本均先 update，本次流程无此绕过。防退结论仅针对标准 update 链，不能宣传为所有 CLI 入口的防退保证。

完整 release 校验由主任务运行，独立审计未重复执行或干扰该过程。


## 正式后端代码逐项核查（SSH 恢复后的补充）

### 证据与总体结论

主任务提取的 `artifacts/production-code-hashes.json` 含正式容器中 133 个 `backend/app` 的 `.py/.json` 文件及 53 个 migration 文件 SHA-256。本审计逐一与候选比较：

- 正式 app 文件没有任何一个从候选丢失；105 个字节相同，28 个不同。候选当前 app 文件共 153 个。
- 正式 53 个 migration 全部与候选同路径文件逐字节一致，无历史迁移覆盖/删除。候选另有 3 个 migration（共 56 个）。
- 28 个 app 差异中 **25 个正式内容精确匹配 Git 历史 blob 的 SHA-256**；相应提交全部通过 `git merge-base --is-ancestor <commit> HEAD`，均为候选祖先。
- 对这 25 个精确历史版本与候选逐项阅读 diff；另外 3 个以 SSH 只读读取正式容器明确代码文件，确认来源差异。**未发现正式独有修复被当前候选遗漏的证据，无需回拷正式旧代码。**
- 不只是根据“Git 祖先”下结论：逐项核实原行为仍保留，差异集中于混合题型/材料、小程序认证与投影、成长记账及题目接口限流。

### 28 项差异明细

下表路径相对 `backend/app/`。历史提交表示该正式文件内容的 SHA-256 与该提交中的同路径文件完全相等，并非称正式机器完整部署了该提交。

| 文件 | 正式 SHA-256 前12位 | 精确历史匹配 / 核验方法 | 候选相对正式的变化判断 |
| --- | --- | --- | --- |
| `schemas/paper.py` | `d3c078a58424` | `a6978a3` | 增加 mixed；原 standard/multiple_choice 保留 |
| `seed/guided_course_v8_6_0.json` | `1001ae5bf1b6` | `直接读取正式文件` | activities/course/validation/schema 等业务内容完全相同，仅 version/contentHash 不同 |
| `services/question_catalog_service.py` | `0a5ea4ff737b` | `a6978a3` | 增加材料还原、mixed 筛选；原访问控制保留 |
| `services/question_service.py` | `659e32679231` | `a6978a3` | 增加资源验证、材料编辑和案例组卷；原单选/多选路径保留 |
| `services/paper_release_service.py` | `925bc8682820` | `c1485f2` | 增加混合快照/材料冻结；正式按实际题目域分布发布修复保留 |
| `services/practice_session_service.py` | `119f36e41462` | `c1485f2` | 增加混合题/草稿/成长记账；正式实际域占比、随机冻结题序、中途退出错题逻辑保留 |
| `services/question_content_service.py` | `12362c320322` | `ee44285` | 增加匹配字段与材料命令处理；旧 PrepStudio 多选答案兼容保留 |
| `services/runtime_domain_migration_service.py` | `ab77a1c409a8` | `a6978a3` | 增加 mixed 类型识别 |
| `services/paper_service.py` | `49db0b4187c2` | `a6978a3` | 增加 mixed/案例完整性校验；原单选/多选规则保留 |
| `services/question_answer_service.py` | `a7fb8f47bc92` | `a6978a3` | 在原判题上增加 matching 入口与验证 |
| `services/paper_import_service.py` | `13cef4a4439b` | `a6978a3` | 增加案例完整性与 mixed 类型推导 |
| `services/paper_composition_service.py` | `07bd907e8ca3` | `a6978a3` | 增加整组案例选题；无案例仍走原配额逻辑 |
| `services/published_paper_access_service.py` | `4c45dd392b86` | `a6978a3` | 仅增加材料/匹配快照字段传递 |
| `services/content_prep_service.py` | `60a70b82ebce` | `a6978a3` | 增加材料原子保存及匹配校验；旧内容准备路径保留 |
| `services/learning_service.py` | `e8ceb58164d8` | `f84e0f2` | 增加匹配、重试凭据、成长统计；多选上次错误答案完整呈现修复保留 |
| `services/user_service.py` | `57a104fad7fe` | `e1cb7f6` | 微信绑定摘要兼容 miniOpenid；原网站 openid 及订阅持久化保留 |
| `core/auth.py` | `196f8cac9b6a` | `7d987ee` | 增加小程序 bearer；原 cookie 登录会话身份保留 |
| `core/config.py` | `12f179b4606a` | `f8cfb53` | 只增题目限流与微信小程序设置声明；未读取正式配置值 |
| `models/question.py` | `ee55ac09b0b1` | `a6978a3` | 数据库检查约束增加 mixed |
| `models/paper_release.py` | `d52a63aeddae` | `a6978a3` | 数据库检查约束增加 mixed |
| `models/training.py` | `80158750cc8b` | `a6978a3` | 仅增加验证题 selected_pairs 字段 |
| `models/__init__.py` | `266999fb1b43` | `直接读取正式文件` | 仅新增评论/材料/mini/growth 模型注册，原注册项全部保留 |
| `api/v1/question_catalog.py` | `424e59ac8118` | `a6978a3` | 增加限流与 mixed 查询参数；原路由/权限保留 |
| `api/v1/paper_releases.py` | `43ac05a8808e` | `558329f` | 只增加题目接口限流；访客目录行为保留 |
| `api/v1/auth.py` | `a88d1cd9f985` | `直接读取正式文件` | 内联法律校验抽取到 core/legal，常量/条件/错误语义一致；其余代码一致 |
| `api/v1/router.py` | `e84dfa89a1be` | `c80f585` | 只增加评论/材料/mini/growth 路由注册 |
| `api/v1/training.py` | `b770b95a1a14` | `9537a25` | 只增加回忆题目与会话接口限流 |
| `api/v1/learning.py` | `0b333a50b7ce` | `d3ffce5` | 增加小程序响应投影/汇总接口/限流，保留原 PC cookie 响应与中途退出接口 |

### 三个无精确历史 blob 匹配文件

只读远端操作范围为容器内 `app/api/v1/auth.py`、`app/models/__init__.py`、`app/seed/guided_course_v8_6_0.json`。未读取环境配置、密钥、数据库或用户数据；未修改远端。

- `api/v1/auth.py`：与候选差异只有法律校验公共模块抽取。正式硬编码 `2026-08-13-v1` 并在 `LEGAL_CONSENT_REQUIRED` 开关启用时验证；候选 `core/legal.py` 保留相同值和分支，并将 ValueError 映射为同一 HTTP 400，微信账户合并/绑定等其余代码一致。
- `models/__init__.py`：差异全为新模型 import / __all__ 增加，无原模型移除。
- 课程 seed：将两份文件解析为 JSON 后逐个顶层字段比较，`activities`、`activitySchemaVersion`、`course`、`packageSchemaVersion`、`validation` 完全相等；只有发布 `version` 和与之相关的 `contentHash` 不同。没有导学课活动、课程或内容丢失。

### 范围限制

该审计检查代码与迁移文件的完整性及历史业务修复保留，不等于正式数据库当前 revision、运行配置或实际迁移可执行性的验证。没有运行数据库写入测试，也未触发部署；UAT 启动/迁移及用户验收由主任务继续执行。


## 17 组 source 清单扩展及 `.211` 四项例外

主任务补充 `artifacts/release-regression-inventory.json`，覆盖 17 组本地 release source。此更大范围仅 `.211` 有四项当前候选不存在的有效文件：

- `styles/teacher-shell-admin.css`
- `styles/teacher-shell.css`
- `assets/teacher-shell-icons.js`
- `src/teacher/shared/teacher-shell.js`

**不能把这四项描述成“已被后续 admin runtime 退休替代”。** 独立核查证据如下：

1. Git 历史显示新增来自 `ba988c9`（2026-09-02，教师工作台新壳层），后续 `25f20c2` / `ab1c057`（2026-09-03，五页 UI 重排与修正）。`git log --all --diff-filter=D -- new-legacy/src/teacher/shared/teacher-shell.js` 没有找到删除记录。
2. `git branch -a --contains ab1c057` 只列出 `refactor/重构UI-待重做`；`ab1c057` 不是候选 HEAD 祖先，双方共同祖先为 `4d14a23`。这是独立未合入 UI 方案，不是当前候选从既有祖先删掉的正式修复。
3. 读取 `.211` 的 teacher-shell.js，它负责侧栏、面包屑与折叠 UI，并说明复用旧 `data-admin-nav` / `data-tq-step` 语义；不是业务数据服务。当前业务入口页面均仍存在，继续加载 `styles/focus-vega-teacher.css`、`src/admin/48-admin-context-nav.js`（teacher-workbench:124、paper-management:323、question-bank:945）与题目工作流模块（question-bank:942）。全源检索没有 teacher-shell 悬空引用。
4. admin runtime 退休指旧数据接口/同步入口收敛，和该 UI 分支不是同一个改动；没有证据支持把两者串成替代关系。

结论：此四项列为独立 UI 分支差异，不能算作已修复遗漏，也不能在本次退款/正式修复中盲目回拷。是否采用该 UI 是另一个产品决定；本次不改页面壳层。

主任务随后核实：**实际正式容器 active 指向 `.225`**，与线上资源一致；宿主机残留 `.159/current.json` 不代表运行状态。该运行时定位补充纠正了仅凭本地或宿主机指针推断版本的风险。
