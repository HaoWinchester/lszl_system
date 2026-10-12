# T16 — implementation report (2026-10-12, resumed session)

## Implemented

- 新增 `POST /api/v1/files/{fileId}/fragments`（files.py + schemas/graph_fragment.py + services/graph_fragment_service.py）：服务端受控跨文件片段粘贴。advisory lock 先于目标/来源行锁；owner 双向校验（404）；来源 revision 不匹配 409 GRAPH_FRAGMENT_SOURCE_STALE；目标 expectedFileRevision 冲突 409；客户端 questionIds/questions/bindings/linkedQuestions 与 PERSONAL_FIELDS 任意深度剥离；绑定只从 `export_card_bindings` 服务端读取，经 `clone_card_bindings` 创建新 ID/sourceVersion；节点配额与模板 load 一致（免费 50 / 会员教师管理员 2500，422 GRAPH_NODE_QUOTA_EXCEEDED）；同 owner 复用 assetId 不复制 blob（validate_graph_assets 校验归属）；合并、绑定、revision bump 单事务，失败回滚。
- tables/resources 暂不合并也不进返回值（T18 表格持久化落地前编辑器 state 不支持，合并会被 autosave 覆盖）；测试断言 'resources'/'tables' not in copy。
- 前端 `pasteGraphFragmentRemotely`（10-graph-editor.js）：source.fileId 存在且 ≠ 当前文件时走服务端端点（异步、串行链防快速连贴 409、链内 fileId 复查防切文件竞态、acceptRevision 对齐 revision、错误码映射文案）；同文件/无来源保持本地同步粘贴原行为。
- 端点挂 import_submission_guard（用户级串行锁）。

## Tests

- `cd backend && .venv/bin/python -m pytest tests/test_graph_fragment_grants.py -q` → 4 passed（绑定继承+客户端字段剥离+可作答、stale/外文件/伪造/无半成品、原子回滚+revoke 不复活+重复独立、模板→非会员抽屉作答解析→会员试卷仍 404→授权随粘贴继承）。
- 定向回归 test_graph_templates + graph_question_access + graph_question_attempts：19 passed。
- 浏览器 `python3 new-legacy/tests/graph-template-practice-browser.py --base-url http://127.0.0.1:5195`：PASS（教师发布免费模板→学生加载→真实键盘复制→切 tab 粘贴→服务端写入+revision 前进→新卡抽屉作答解析截图 cross-file-paste-practice.png→伪造 questionIds 剥离→stale 409 无半成品→会员试卷 404）。
- T07 回归 `graph-cross-file-copy-browser.py`（本地/跨标签粘贴路径，适配两处 wait_for_function）：PASS。

## Independent review

- 审查（commit 3b52dcca）：无 Critical/Major；全后端套件 1036 passed 由审查员实跑确认。
- 修复 4 Minor（同 owner blob 放大、链内竞态、决策断言、submission guard）→ commit b8491cee。
- 复审：全部通过；补 'tables' not in copy + elements-only 断言 → commit（test(graph): assert fragment merge scope）。

## Known leftovers（留 T18/T20）

- 跨集合（elements/tables 共用 t 前缀）ID 去重：T18 合并 tables 时必须补。
- node_ids[:2500] 静默截断 → 建议改 422（T18）。
- save_file 本身无节点配额（既有缺口，学生可 PUT 膨胀文件）：非 T16 引入，T20 汇报。
- 同文件粘贴不继承绑定（保持本地路径原行为）；跨文件才继承。
