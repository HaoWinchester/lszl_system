# 同一多题归纳地址刷新后题目交替：历史重复记录修复（本地 v359）

用户提供带固定 paper/release/question/bank 参数及 `workspace=pmp-pattern-workspace` 的真实地址，并反馈每次刷新出现不同题目。本轮确认之前仅使用一份正常画布的测试数据，遗漏了同一账号历史重复内部ID的情形，先前“流程已修好”的验证范围不足。

## 真实数据与复现证据

只读查询开发库发现当前账号存在两条服务器记录，关系ID分别以 `en845w`（当前账号hash）和 `1gthaer`（历史guest hash）结尾；owner均为当前账号，两个 payload.id 都是 `pmp-pattern-workspace`。排查前已保存本地只读快照，未删除、合并或迁移真实记录。

后端按 updated_at 倒序返回列表。旧适配器却用 payload.id 作为客户端唯一ID，后返回的较旧记录覆盖较新记录，remoteIds保存目标也被覆盖；页面初始化自动保存后，该记录又成为较新项，下次刷新便反向覆盖。不是URL中questionId随机变化。

独立5297 FastAPI/PostgreSQL + 真实Chrome构造同结构的两条历史记录，分别含题1/题2。未修改页面状态，直接连续刷新四次，观察到 **题1→题2→题1→题2**，PUT目标在两条服务器记录间交替，客户端目录只有一项而实际数据库两项。证据：`artifacts/workspace-refresh/refresh-before.log`、`before-results.json`及四张截图。

## 修复

- 恢复后的客户端唯一ID改为服务器 row.id，保留每一条服务器记录，拒绝再按重复payload.id折叠。
- 旧默认链接优先解析当前账号对应的已有默认画布；其它显式服务器ID精确打开该记录；通用历史payload别名按固定ID排序解析，不依赖更新时间。
- 旧URL与设备上次活动ID在初始化ensure前归一为固定服务器ID，避免创建空白别名或误打开另一画布。
- PUT只写所选服务器记录；API payload.id保留历史别名以兼容旧链接，客户端store.id使用服务器ID。除了这项身份规范化，业务nodes/edges/strokes等对象保持原样。
- 新建默认画布的owner hash命名规则、权限/账号切换、加载失败保护及保存失败重试继续保留。

源码修改集中在现有 `frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js`，未新增数据库结构或批量修复用户数据。

## 最终 v359 验证

- `node --test frontend/scripts/direct-runtime.test.mjs`：**21/21**。覆盖重复payload ID两种列表顺序、固定旧默认链接、显式打开另一条记录、仅更新所选row、通用旧别名保存后仍有效、旧active恢复、空default首次POST和后续PUT不重复新建、原权限/失败/账号切换回归。与其它相关定向测试合计39项通过。
- `pnpm --dir frontend test`：**364/364**，E2E契约 **9/9**，发布脚本契约通过。一次全量暴露新增断言用写入前时间戳比较写入后对象，改为比较store.write返回的实际持久化对象，保留完整业务对象断言；产品逻辑未因此变动。最终日志 `artifacts/workspace-refresh/frontend-full-final.log`。
- `pnpm --dir frontend test:design`：**5/5**。
- 最终不可变包、无source override：`python3 new-legacy/tests/learning-theme-browser.py --base-url http://127.0.0.1:5297 --out-dir artifacts/workspace-refresh/immutable-general`：原主题独立、入口五尺寸与键盘、背景、三轮模式往返、设置、草稿失败恢复 **6/6**。
- 专项：`python3 new-legacy/tests/learning-theme-browser.py --base-url http://127.0.0.1:5297 --case duplicate-refresh --out-dir artifacts/workspace-refresh/immutable-duplicate-clean`：**通过，退出0**。8轮刷新/重新打开原旧地址，画布ID及题1均固定；两条记录都保留；所有自动PUT只到目标row；显式打开另一历史记录后显示题2、刷新仍题2，再回旧链接仍题1。核对真实DOM题号、accessible题目标题、store、API两份数据，pageErrors=[]。证据 `duplicate-refresh.json` / `duplicate-refresh-final.png`。
- 最初把两个套件连续压在同一fixture时触发真实接口429限流，题库暂不可读，该次不计为通过；最终在新建的隔离fixture中重跑全部专项断言，无限流、未放宽生产限流。此前source override只作为开发验证，最终结果以上述无override运行为准。
- 本轮后端业务仅有先前图谱模板名称校验，已完整执行 **1104/1104**（见[图谱完整流程报告](2026-10-19-graph-full-flow.md)）；此次359仅改前端适配器和测试，没有再次重复12分钟后端全量。

实际账号数据只读前后核对：两条关系ID仍在，nodes/edges/strokes/tables/groups与排查前完整一致，`actual-data-preservation.json`。当前可用内置浏览器会话提示登录，默认本地管理员登录也未成功，因此**不声称已在真实账号的已登录浏览器直接完成刷新测试**；真实数据结构已只读确认，完整浏览器复现与验证使用独立账号/数据库，没有重置密码或改动用户卡片。

本地active release **v9.0-p4.1.359**，sourceHash `831e18ff83fb3b4b68c4bf5cebb272b66dcdc93fe4c8cef785db889bed816f58`，adapterHash `f07f93b07c09488204eb9c56c9b11e00ca9ccad98536707eaaf84cf502f3f816`。官方update验证并promote成功；public与site **1148文件**，完整路径和字节一致；实际5173关键资源匹配359。图谱业务5个关键模块与已经完整浏览器验证的358逐字节一致。

仅更新本地，未部署、推送或合并UAT/main。独立5297测试服务及对应数据库测试完成后精确清理，用户5173保持运行。原地址继续可用，打开后会归一到固定服务器画布ID；其它历史记录单独保留。
