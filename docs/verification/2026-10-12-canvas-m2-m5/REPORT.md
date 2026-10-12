# M2—M5 开发与 UAT 验证记录

状态：开发中；尚未部署本批功能，不代表 UAT 验收通过。

基线：`uat` 提交 `e493565e586ebf6401fca1b3e8ebe21fb549dda6`，当前 UAT `v9.0-p4.1.311`。实现分支：`codex/canvas-m2-m5`。用户授权全部剩余功能；仅在自检通过后部署 UAT，main 保持不变。

| 任务 | 开发与审查 | 验证证据 |
| --- | --- | --- |
| T05 | 开发、审查完成；6448f7d6、64d4a6b0 | [定向测试与浏览器证据](T05-REPORT.md) |
| T06 | 开发、审查完成；2bd21a8c | [定向测试与浏览器证据](T06-REPORT.md) |
| T07 | 开发、审查完成；3b702e57、a3614fac | [定向测试与浏览器证据](T07-REPORT.md) |
| T08 | 开发、审查完成；f208fcb4、7514b69d | [定向测试与浏览器证据](T08-REPORT.md) |
| T09 | 开发、审查完成；a73554a5、debacb8f | [定向测试与浏览器证据](T09-REPORT.md) |
| T10 | 开发、审查完成；c0657799、a4104ed7 | [定向测试与浏览器证据](T10-REPORT.md) |
| T11 | 开发、审查完成；25a457cf、e41b2538 | [资源权限与往返证据](T11-REPORT.md) |
| T12 | 实现与审查完成；4d04ff7f、8e219776；R05 保真差异待验收 | [导入与安全验证](T12-REPORT.md) |
| T13 | 开发、审查完成；e85caf98 | [绑定权限与练习证据](T13-REPORT.md) |
| T14 | 开发、审查完成；fb3ad89d、5e147249 | [抽屉角色与浏览器证据](T14-REPORT.md) |
| T15 | 开发、审查完成；28ca4089、26a6ab0b | [模板中心验证](T15-REPORT.md) |
| T16 | 开发、审查完成；3b52dcca、b8491cee、4b89296f | [片段授权继承验证](T16-REPORT.md) |
| T17 | 开发、审查完成；3d67c65e、165598d0 | [表格模型验证](T17-REPORT.md) |
| T18 | 开发、审查完成；9cd874fb、efa93333、4a950851 | [三页持久化验证](T18-REPORT.md) |
| T19 | 开发、审查完成；03014f1c、71904a04 | [三页表格 UI 验证](T19-REPORT.md) |
| T20 | 整体验证与整分支审查完成；a13a4917；后端 1044 passed、前端 333 passed、设计 5 passed | [本文件与本表] |
| T21 | 候选构建与部署进行中 | 待记录 |

T22 为用户本人验收，不由自动化测试或智能体确认替代。


## T20 整体验证（2026-10-13）

- 全量后端 `cd backend && .venv/bin/python -m pytest tests/ -q`：**1044 passed**（8m01s）。
- 前端 `pnpm test`：**333 passed / 0 fail**（此前一次 1 fail 为间歇时序，复跑两次全绿）；`pnpm test:design` 5 passed。
- 整分支独立审查（uat..HEAD 44+ commits，general-purpose 审查员实跑复核）：跨任务链路（模板×表格校验、片段×表格排除、授权冻结快照、临时会话×表格）全部自洽；owner 隔离/advisory 锁序/客户端授权字段/XSS 四项安全不变量全部通过；两个一行级项（模板 load 422 映射、片段 tables 死工作）已在 a13a4917 关闭。
- 结论：**分支可进入 UAT 候选**。
- UAT 观察清单（非阻断）：save_file 无节点配额（既有缺口）；模态开启时 paste 穿透主画布选中表格；`node_ids[:2500]` 静默截断；77 拖动逐事件 store 写；T15 性能/可达性 Minor；表格移动端触屏与行边界拖拽无专项断言；DPR/缩放完整矩阵归 D10 全局任务（表格为真实 DOM 文字，与卡牌同一清晰度机制，不单独许诺所有缩放同样易读）。

## T21 UAT 部署（2026-10-13）

- **v9.0-p4.1.316 已部署 https://uat.aihuanpu.com**（容器 current.json 与公网版本核对一致，健康 ok）。
- 部署验收发现并修复 4 项（详见 .superpowers/sdd/.../task-21-report.md）：ink 测试缺 text-edit-session 依赖、table-controller reset 残留未声明变量（严格模式 ReferenceError）、interaction-focus 测试段落状态污染（改切干净 fixture）、T13 搜索 fixture 首页挤占。
- 证据：artifacts/canvas-m2-m5/t21/deploy-uat8.log；清单校验 candidate-inventory.json。
