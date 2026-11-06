# 知识星图讲解音频

状态：427 已完成完整发布门禁、UAT 部署、原件导入和实际播放核验；等待用户本人业务验收，未合入 main。

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

## UAT 部署与原始音频

- 实现提交 9aac5186，无冲突合入 uat 的提交 15eed5bc；合并后的文件树与已测实现完全一致。使用命令级系统代理推送 uat 与功能分支并核对远端引用。main 保持任务开始时的 6256275850e25c30cd7f3c696167c9d779122a46，分支均保留。
- `PYTHONDONTWRITEBYTECODE=1 bash deploy/update-uat.sh` 退出 0，总耗时53秒；相同内容的完整验证证据复用3秒以内，无跳过或降级。实际运行427、回滚426，1291文件、关键管理页面存在，健康/数据库/小程序/助手检查通过。
- 两原件私有暂存到UAT容器，上传前后核对完整SHA256。两项CLI dry-run均通过后才apply；重复apply均created=false。成功后仅删除本次临时原件，数据库中的原始字节、映射、审计完整保留。
- 原件一11061748字节、343679ms、SHA256 `99d4262e42cf7c3f771f10f207fa88d23e5ff4e61434bc1913af867e9c24311b`；原件二9614901字节、298725ms、SHA256 `a2877510dc9020e54bf97ef07d56e2fef5b46243154a7387cc7de339e3caa299`。认证全文读取流式哈希均与本地原件一致。
- 两节点各audioCount=1，其他节点无新增音频标记。摘要6字段白名单、空分页、匿名list/GET/HEAD共6个401、4个HEAD零正文、4个起始/后缀1024字节206及14个非法Range416均通过。
- agent-browser/Playwright所用系统HTTPS信任链保持校验，未忽略证书。实际Chrome在1440/390两尺寸从可见学习入口进入星图、列表选节点后点击播放两原件：时间推进、解码时长343.678549/298.724717秒、中段171.84/149.36秒seek并续播、暂停和关闭释放均通过；页面异常0，练习写请求0。测试浏览器进程静音，未改变页面audio.volume或muted状态。
- UI核验第一次被既有新手引导遮罩拦住；仅在验收脚本中增加通过真实可见“跳过”关闭引导的正常导航，产品源与原断言未改。随后两尺寸全部通过。
- 实际练习统计与每节点学习事实before/after完全相同：156次、topicCount320、316可见节点、45点亮、18直接练习节点；未固定旧目录数量来覆盖现有内容。
- 公网5公共页和容器7页HTML、11静态资源/构建包、后端导入CLI/service哈希均与427不可变版本/已测源码一致；匿名教学页正确403，正式容器ID/镜像/完整current指针与部署前一致。
- 导入后另做完整UAT数据库备份并校验非空与pg_restore目录：`/home/ubuntu/lszl-uat-backups/20261106T065327Z-knowledge-audio-data`，dump54553628字节，原始音频与绑定包含在该备份中，manifest记录SHA256。未删除旧备份。

证据目录 `artifacts/knowledge-audio/`：release-update-427.log、uat-deploy-427.log、uat-import-result.json、verify-uat-audio-result.json、verify-uat-assets-result.json、verify-uat-audio-browser-result.json、4张uat-audio节点桌面/手机截图；原始导入manifest与本地原件保留。私有测试账号密码不提交、不输出到日志。

用户验收入口：<https://uat.aihuanpu.com/index.html> → 登录 → 学习入口 → 知识星空 → 考点详情与列表。选择“参与计划 · 讲解”或“储备分析 · 讲解”，点击“播放讲解”。也可点击对应星点后进入“音频讲解”。这是开发自检和部署核验，尚不代表用户已验收；等待用户明确结论后才能合入main及正式发布/导入。
