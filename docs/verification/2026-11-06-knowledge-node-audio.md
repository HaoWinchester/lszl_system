# 知识星图讲解音频

状态：427 完整发布门禁通过，正在准备 UAT 部署；用户业务验收待执行。

## 需求与实现

用户提供的原始 AAC/m4a 已完整解码验证，保留音质与文件字节，不转码、不将原件加入前端或 Git：

| 讲解 | 当前星图节点 | 业务节点 ID | 时长 | 原始字节 |
| --- | --- | --- | --- | --- |
| 沟通管理计划vs相关方参与计划 | 人 / 利益相关方与沟通管理 / 区分三类文档 / 参与计划 | kp-pmp-people-1-1-7-k02 | 5分44秒 | 11061748 |
| 应急与管理储备的区别 | 过程 / 风险管理过程 / 监督风险 / 储备分析 | kp-pmp-process-5-5-6-k01 | 4分59秒 | 9614901 |

两节点已通过实际 UAT 只读查询确认 active，当前知识树为 taxonomy-pmp-complete-v1。第一段按用户指示挂“参与计划”，不按文件名误挂同名“沟通管理计划”节点。

- 新增独立 PostgreSQL 知识音频表，按 taxonomy ID + 节点业务 ID 绑定；节点行被目录整体重建时保留音频，当前目录/节点失效则不对外读取。原文件保存在数据库，随现有数据库备份保护。
- 元数据按节点、按页读取，仅返回播放器消费的字段。星图主接口只为有音频节点增加 audioCount，不附资源列表、URL 或二进制，不改练习/成长统计。
- 播放端点复用登录认证和当前已发布知识树权限，HEAD 不查询二进制，GET 支持单 Range / 206 / 416，PostgreSQL substr 只传所请求字节。显式整段 GET 可读取完整音频，未宣称服务端分块流。
- 导入 CLI 默认只读，显式 apply 且 active admin/teacher 才能写入；SHA256 校验、确定性资源标识、重复导入幂等、审计和教学内容 revision 采用同一事务。哈希前使用 JSON 三元组编码，含冒号的不同知识身份不会碰撞。
- 选中节点后显示“音频讲解”入口，列表有“讲解”标记。仅打开有音频节点详情才加载共享播放器模块与该节点元数据；仅用户点击播放后才设置 audio.src。使用原生 controls、preload=none，可暂停与拖动进度。
- 切换节点、关闭详情（含原生 close）、刷新、关闭星图、换账号和 pagehide 都取消旧请求、停止播放、清理 src；使用代次与账号检查阻止迟到响应。

## 已执行专项

- 两原始音频 `ffprobe` 元数据与完整 `ffmpeg -v error ... -f null -` 解码检查退出 0。
- 后端相关回归 36 项通过，含 8 项新增音频用例；提交后仅刷新元数据字段的最后修改，新 8 项再次通过。
- 真实隔离数据库 Alembic autogenerate 生成 456f42ad29df（前序 1b6f9a2d4c80），仅新增 knowledge_node_audios 表，单 head；未将已有无关模型漂移带入迁移。
- 独立审查发现并修复冒号拼接标识碰撞，新增两有效科目的真实导入隔离测试先红后绿；其余权限、Range、摘要字段、事务、前端按需和清理路径审查无阻塞发现。
- 原有星图 34 项 Node、dashboard 16 组、original 5 尺寸与 semantic 3 尺寸检查通过。新增真实 HTTP + 可解码 AAC 浏览器专项覆盖桌面/手机播放、暂停、seek、倍速、Range、20+1 分页、空资源、元数据/媒体/脚本失败重试与迟到响应隔离；最终结果以完整门禁和后续记录为准。
- 新浏览器专项已接入 validate-new-legacy-release.sh 的知识星图检查阶段。
- 当前同步候选 1291 文件，相对实际 active 426 的 1288 文件无缺失路径，新增共享播放器、约 20KB 测试 AAC 与专项浏览器脚本；admin-console 保留。用户原件未进入静态包。

本地证据位于 artifacts/knowledge-audio，原件 SHA256、大小和映射记录在 import-manifest.json。只允许合入/推送/部署 UAT，用户明确验收前不合入 main。

后续正式发布还需在正式备份完成后重新核对正式库当前知识树与节点，再使用同一原件和 manifest 的 SHA256 通过 CLI 导入；仅发布功能代码不会把 UAT 数据库中的音频自动写入正式库。原件已在本工作区 artifacts/knowledge-audio 保留，也可从验收通过的 UAT 认证内容端点按 SHA256 校验取回，禁止将媒体直接复制到 active release site。

## 完整发布门禁

`PYTHONDONTWRITEBYTECODE=1 node frontend/scripts/manage-new-legacy.js update new-legacy --validation-profile full` 退出 0，总耗时 1974 秒。后端 1341 项、前端 421 项、运行/扩展/部署契约、做题与知识星图（含新增音频）、共享画布、课堂恢复、跨功能数据、学习资产及视觉检查均通过，无跳过或降级。视觉差异：练习桌面/手机与自由图谱手机 0%，自由图谱桌面 0.001%。

候选 source SHA256 `952f1a04a8e70e7be0f098217066f3f5ef63398b8e8f4369be7df7630e7bfbf0`，site SHA256 `2017627e6e61a2579c1958d86a6f3de70e98ebd9d94495de8328ecb67866f470`；源检查与不可变包匹配，当前版本427、回滚版本426。

部署前 UAT 备份已校验：`/home/ubuntu/lszl-uat-backups/20261106T064347Z-knowledge-audio`，代码包148898089字节、数据库dump36407091字节；非空、tar/pg_restore目录、SHA256与manifest通过，旧运行镜像已留存标签，不删除既有备份。
