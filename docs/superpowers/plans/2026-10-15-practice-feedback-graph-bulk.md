# 普通练习反馈与图谱批量配题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现用户已确认的实时反馈开关及可预览的批量配题，完成自检并部署 UAT。

**Architecture:** 反馈展示策略统一在既有 practice mode policy/session core 中，保留真正判题与结算。批量配题由独立后端 service 负责检索/签名预览/事务确认，复用 graph_question_service 的快照与绑定入口；前端独立 controller 接收当前文件和选中卡片。

**Tech Stack:** FastAPI、Pydantic、SQLAlchemy async、PostgreSQL、itsdangerous、原生 JavaScript/CSS、Node tests、pytest、Playwright Chrome。

## Global Constraints

- 用户已确认设计文件 `docs/superpowers/specs/2026-10-15-practice-feedback-graph-bulk-design.md` 所述行为；不增加 AI 生成。
- 仅当前工作区 `codex/practice-feedback-graph-bulk` 写入；不安装依赖；new-legacy 为前端权威源。
- 公共能力先扩展共享模块；不复制单卡事务/快照规则；后端保持 owner 与角色校验。
- 每卡新增默认3，范围1—100，绑定总数最多100；批次最多500卡/2000新增绑定。
- 只部署 UAT，未经用户明确验收不合 main；git push 用当前命令代理并核对远端引用。

### Task 1: 普通练习反馈策略与恢复

**Files:** 修改 `new-legacy/src/100-practice-mode.js`、`111-practice-session-core.js`、`112-practice-answer-sheet.js`、`115-practice-mode-policy.js`、`practice-mode.html`、`styles/practice-mode.css`、`backend/app/services/practice_session_service.py`；测试 `new-legacy/tests/practice-instant-feedback*` 与 `backend/tests/test_practice_sessions.py`。
**Interfaces:** runtimeState.instantFeedback:boolean（缺失=true），展示策略通过 policy 与 answer-sheet session 统一传递；分数仍来自既有 draft/服务端。
- [x] 写失败用例：普通关闭→作答只显示已选、答题卡仅已答/未答、无解析/经验泄露；恢复开→原答案回放；其他模式不改变；保存退出后恢复 false；结算成绩相同。
- [x] 跑 Node/Chrome/API 定向测试验证红灯，再扩展 policy/session 白名单和控制器展示，新增可访问开关与禁用说明。
- [x] 重跑原标记/显示答案、答题卡、单/多/配对浏览器测试，确认旧会话默认开启。
- [x] 提交独立实现及验证记录；源检查通过后由主控同步产物。

### Task 2: 批量匹配与原子绑定 API

**Files:** 新增 `backend/app/services/graph_question_batch_service.py` 与 `backend/tests/test_graph_question_batch.py`；扩展 `backend/app/schemas/graph_question.py`、`backend/app/api/v1/graph_questions.py` 和既有 `graph_question_service.py` 公共绑定逻辑。
**Interfaces:** `POST /api/v1/graph-questions/files/{file_id}/batch-preview` 输入 `{expectedFileRevision,nodeIds,countPerCard}`，返回 `{fileRevision,previewToken,cards:[{nodeId,title,existingCount,requestedCount,questions:[{id,revision,title,bankName,stem,matchReason}],shortfall}]}`；`POST .../batch-apply` 输入 `{previewToken,selections:[{nodeId,questionIds}]}`，返回 `{fileRevision,addedCount,cards:[{nodeId,addedCount}]}`。
- [x] API 测试先证明不存在接口；seed 唯一关键词、图片、多卡、已有绑定和不同 owner。
- [x] 实现数据库卡片读取、标题/关键词安全匹配、有效题过滤与确定排序、同卡去重和容量提示；签名预览不写入。
- [x] 将单卡关联公共规则提为事务内可复用函数；确认锁图谱/教学内容，验证签名时效、账号文件、版本及候选子集、题源版本，单事务追加并更新一次 revision。
- [x] 测试篡改/过期、跨账号/无权限、冲突、无匹配、重复确认、候选减少、题源变化回滚及资源快照；跑现有 graph question API 测试并提交。

### Task 3: 批量配题 UI 与真实操作

**Files:** 新增 `new-legacy/src/graph/question-batch-controller.js`、`new-legacy/styles/graph-question-batch.css`、`new-legacy/tests/graph-question-batch-browser.py`；扩展图谱工具注册 `src/19-home-toolbar-registry.js`、`src/20-flashcards-toolbar.js`、`src/10-graph-editor.js`、`index.html`、`frontend/scripts/homepage-bundles.json`。
**Interfaces:** `KGGraphQuestionBatch.create({getContext,getNodes,getSelectedIds,flush,onRevision}).open()` 读取当前已保存图谱，复用 API 和 overlay/fullscreen 挂载；修改配置/关闭/切换取消网络与令牌。
- [x] 浏览器失败用例覆盖入口、三种卡片选择、默认数量3、数量非法、预览无写入、候选取消、批量确认/刷新、空结果、服务错误后重试、版本冲突、关闭后迟到响应、手机可达和角色限制。
- [x] 实现列表搜索、范围与数量、预览列表/不足提示、候选勾选、确认成功后接纳文件 revision；原单卡抽屉可看到新增题。
- [x] Node 契约与真实隔离数据库浏览器通过，核对键盘退出、全屏和当前图谱切换隔离。
- [x] 提交实现，更新本计划勾选与验证记录。

### Task 4: 整体验证、审查与 UAT

**Files:** 同步产物、VERSION/seed、验证记录及发布脚本既有链路。
- [x] 一次完整后端/前端/设计及真实浏览器集成验证，独立整分支审查，修复确认问题并定向复测。
- [x] 从当前 active release 核对文件清单与关键页面，递增 VERSION；使用管理器完整门禁生成不可变候选，不手动改 site。
- [ ] 已验证提交快进合入 uat，通过代理推送并核对远端引用；标准 `bash deploy/update-uat.sh` 部署。
- [ ] 核对容器实际 current.json、文件数量、公网版本/资源/健康及角色交互；记录证据，保持 main 不变，等待用户 UAT。
