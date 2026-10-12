# M0 / M1 基线与实施记录

本轮用户已确认采用 2026-10-12 设计推荐，并授权 T00—T04 开发、自检及 UAT 部署；M2—M5 不在本轮范围。UAT 通过以用户本人反馈为准，不合入 main。

## M0 原始基线

- 起点：uat / `6289fa0b`；本地 active `v9.0-p4.1.309`，1051 文件。功能分支 `codex/canvas-m0-m1`，遵守当前工作区内写入约束。
- 原始需求、设计、计划、任务与五张用户截图均保留在 `docs/superpowers/specs/`。
- 从 `new-legacy/` 执行六个定向 Node 测试：14 通过、1 失败。失败为 `v90-p4529-deep-recall-database-adapter.test.js` 的恢复快照预期漏 `strokes:[]`，实际 adapter 正确规范化笔迹。修复 fixture 后该文件 6 项通过；同时增加非空笔迹在网络失败后完整保留及重试验证。
- 浏览器基线：`python3 new-legacy/tests/graph-fullscreen-editing-browser.py --base-url http://127.0.0.1:5189 --baseline`。真实 Chrome + 独立 `kg_pytest_*` 临时数据库。选中卡片双击编辑，Backspace 确实弹出整卡删除确认；进入画布全屏打开详细编辑，`nodeModal` 不属于 fullscreenElement，截图不可见。
- 原始证据：忽略目录 `artifacts/canvas-m0-m1/graph-baseline.json`、`baseline-input.png`、`baseline-fullscreen.png`。新脚本使用合成图谱，不涉及业务题库。
- R14、R04 的进一步浏览器基线与实验由 T02、T04 记录汇总。XMind／Excel 导入样本在相应 M3／M5 任务准备，本轮不提前实现导入或表格。

## 验证边界

定向测试先 RED 后 GREEN；源与同步产物用于本地验证，部署须验证 active release。最终测试、发布版本和 UAT 结果补充在本目录的 M1 验证报告中。
