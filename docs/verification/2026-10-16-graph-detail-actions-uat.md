# 知识卡片详情按钮精简（2026-10-16）

用户要求做题按钮“先隐藏”、设为连线起点按钮“去除”。权威源 `10-graph-editor.js` 的既有详情渲染中，做题入口加 native hidden，保留原抽屉与权限逻辑；移除 toggleSourceBtn DOM 和绑定，其他连线入口不变。批量配题成功提示不再引导点击隐藏入口。

## 开发验证

- 修改前真实页面检查明确失败：graphPracticeBtn 没有 hidden 属性（`artifacts/graph-detail-actions/red.log`）。修改后通过：`python3 artifacts/graph-detail-actions/run-browser.py`，真实隔离 FastAPI/PostgreSQL 的图谱批量配题、持久化、恢复、移动端、权限流程通过；服务退出0、临时库无残留。
- 同次浏览器检查：普通/锁定/悬停重绘、桌面/390px手机下做题按钮隐藏、起点按钮不存在；编辑弹窗/取消、关闭详情均正常。
- 为保留内部能力回归，既有抽屉/模板测试统一通过 `tests/helpers/graph_detail_actions.py` 先断言入口隐藏/去除，再程序调用隐藏入口；不把该内部调用描述为用户可见流程。
- `node --test frontend/scripts/graph-question-drawer.test.mjs` 通过（包装2项底层Node测试）；两个生产模块语法检查及六个Python文件编译通过。
- 历史T14/T15/T16独立抽屉及模板脚本依赖各自fixture，本次迁移后做编译检查，未单独运行；共享隐藏入口和保留抽屉行为已由真实批量图谱回归覆盖。
- 独立审查21ae4a26通过，无待处理问题，记录`artifacts/graph-detail-actions/review.md`。

## 发布检查

336候选文件1138，旧active335为1137，唯一新增为共享测试助手；无文件删除，关键页面均在。完整full候选门禁通过，933秒：后端1068、前端335、Python契约9、部署脚本4及完整浏览器流程通过，包含新的详情操作断言和真实批量配题。已合入uat并代理推送，功能部署提交为e0b57dbae22ef1204a65419cbc8adb59631fb0e9；main保持0f86fabdeca98379ec50753b793b74a915671677。首次部署在SSH前置检查退出255；用户要求重试后连接恢复，标准UAT部署已完成。main保持不变，等待用户UAT验收。


## 首次部署受阻（已恢复）

`bash deploy/update-uat.sh` 在首次SSH前置连接阶段失败，直接证据为`ssh: connect to host 49.235.159.4 port 22: Operation timed out`（35秒、退出255），未进入rsync、镜像重建、容器重启或迁移。脚本通用“助手前置配置缺失”提示不是配置确实缺失的证据。

随后对相同已配置SSH别名执行8秒直连重试，以及当前本机HTTP CONNECT/SOCKS代理尝试，均未连接成功。HTTPS公网服务正常；DNS仍解析49.235.159.4，公网页面仍v9.0-p4.1.335，公开10-graph-editor.js仍未含hidden且保留toggleSourceBtn。当时这次按钮修改尚未上线。

本地336候选已通过完整full验证，关键文件齐全，uat远程代码已就绪。后续重试部署与公网结果见下。未合入main，保留功能分支与永久main/uat分支。


## 重试部署完成

用户要求重试后，SSH恢复连通。标准 `bash deploy/update-uat.sh` 全部成功（73秒），复用已通过的full候选证据，部署提交 `ab6ab0e1fb8f6f97728166bf6cab358ce62fe4b9` 与远端deploy-state一致。容器实际active为 `v9.0-p4.1.336`，previous为335，site1138文件；sourceHash `94edbf737265ee64f7b91262716906c53939dd9826760b93ad7d62ef87c207f9` 与本地候选一致。HTTPS与数据库健康正常。

公网只读检查 `python3 artifacts/graph-detail-actions/public-smoke.py` 通过：7项JS/CSS/bundle资源逐字节匹配实际active；4个游客页面版本336、页面错误0；1440桌面与390手机的实际详情渲染确认graphPracticeBtn原生hidden且不可见、toggleSourceBtn不存在，编辑/删除节点仍在。使用本地合成节点渲染并阻止全部API写请求，未修改UAT业务数据。

证据：`artifacts/graph-detail-actions/deploy-retry.log`、`public-smoke.json`、`public-smoke.log`，同目录`uat-v9.0-p4.1.336-1440.png`与`uat-v9.0-p4.1.336-390.png`。发布地址：https://uat.aihuanpu.com/index.html 。等待用户本人UAT验收；main未修改。
