# Task 2 实施报告

状态：DONE

## 第二轮修复

- releaseId 非空时，practice / deep recall / single deep study 必须先读取对应 `PaperReleaseQuestion.snapshot`；查不到版本、模式、题目或授权时直接拒绝，不再回退普通公开题。
- `training_progress`、`recall_progress`、`recall_question_snapshots`、`practice_mistakes` 均按 release 隔离；canonical 题目删除不再级联或阻止 snapshot-only 学习状态保存。
- 新增 Alembic revision `c4e8f2a7d910`，移除 `paper_releases.paper_id` 和 `practice_mistakes.question_id` 的删除耦合，并为迁移账本加入冻结 `source_payload`。
- paper mapper 只读取 scan 时冻结的 payload；写入后从 `PaperRelease` / `PaperReleaseQuestion` 回读 canonical。mapper 失败保持 pending，阻止 verified/drop。
- catalog/history 相同 release 碰撞时 current 先处理，history 合并题目快照但不覆盖 current 状态。
- publish / withdraw 统一为 advisory lock 先于行锁；新增真实双 session 并发测试，使用 `asyncio.wait_for(..., timeout=3)`，禁止把挂起误判为通过；单测实际完成 0.21 秒。withdraw 非 active 返回 409。
- history 支持分页；questions 响应包含 release metadata 并限制在 1MB 内，返回 `consumed` / `nextOffset`；分页续取测试覆盖无重复、无跳题。
- 增加公开 canonical 已变化时仍按 frozen 答案完成真实作答正反判定。
- 增加关系 release 的 deep recall `GET -> PUT -> GET -> reset` 正向生命周期及无 release 隔离断言。

## 第三轮修复

- 迁移账本新增 `expected_hash` / `expected_count`。paper release source 在 scan 阶段按领域规则规范化；非法/缺快照源直接标记 failed。verify 每次从 `PaperRelease` / `PaperReleaseQuestion` 关系表重新回读并用同一领域形状计算 hash/count，删除或污染目标无法 verified；drop 门禁同样使用 expected 值。
- current/history 相同 releaseId 时 current 先写且 history 跳过覆盖，current status/snapshot 保持权威。
- 新增 Alembic revision `e5b9c3d7a120`：四类学习状态改为 nullable release FK，以 `COALESCE(release_id, '')` 唯一索引表达普通题唯一身份；`recall_progress` 改用独立主键；`LearningEvent.question_id` 改为 `ON DELETE SET NULL`。
- `save_session`、错题与答案写入统一使用 `releaseId:questionId` advisory scope；无 release 在数据库中保存为 NULL，对外保持空字符串兼容。
- 学生可按精确 releaseId 继续读取 `superseded` detail/questions；withdrawn 仍拒绝。
- 单题快照自身超过响应上限时返回 413，避免 `consumed=0` 死循环；发布 metadata 超过 64KB 返回 422，零题页也保持小于 1MB。

## 验证

- 定向全量：49 passed，pytest 报告 28.81 秒，shell 总耗时 33.517 秒；覆盖 paper release、entitlement、practice、learning workspace、deep recall、migration ledger。
- 并发锁序测试：3 秒硬 timeout，实际 0.22 秒。
- Alembic：`e5b9c3d7a120 (head)`，单 head；测试库从空库升级成功。
- `git diff --check -- backend/app backend/tests backend/alembic`：通过。

## 边界

- 共享教师跨 owner 行为保持现有规格，未收紧。
- 未修改 `frontend/public/new-legacy/` 或 active release。
- 未 commit。
