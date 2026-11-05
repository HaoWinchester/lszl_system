# PMP整卷随机10道不计分题

## 已确认需求

用户选择“仅180题PMP整卷启用”。规则限新建PMP、practice/challenge、实际180题且整卷库存180题的模拟会话；短卷、其他科目、学霸、复仇、既有活动会话及历史成绩不改。

## 实现与数据边界

- practice_scoring_service在开始时用SystemRandom无放回随机10题，冻结为服务端scoring_snapshot.pmpPretest版本1。名单不从公开的selectionSeed派生，客户端和试卷配置不能指定。
- 会话公共响应过滤该私有字段。成绩报告在交卷后返回最小unscoredQuestions数组，每项只有questionId、number；题号按本次冻结答题顺序计算。目录和历史摘要接口没有新增字段。
- 模拟分、满分、PASS/FAIL及领域成绩排除对应题的得分与满分；保留已有单题权重。全卷答对/答错/未答、全卷正确率、经验、长期错题和回顾仍包含全部180题。
- 报告复用既有样式增加计分说明和10个题号入口，区分全卷正确率与计分结果；题目回顾标注不计分。通过已有只读回看打开正确、错误和未答题。
- 已完成报告由原冻结快照读取，不重抽；旧活动会话没有新策略时仍按旧规则完成。损坏的新策略返回409，避免无声改用另一种分数。
- 本次不调整模拟及格线、领域配比、考试时长或其他页面样式。新规则是平台模拟，原非官方成绩声明保留。

## 开发验证

- 新单测先复现满分仍180、错误计分和缺少说明；修复后node报告5项及后端报告语义17项通过。后端定向回归43项通过，包含范围、权重、3种排除结果、领域分、可改变模拟判定、私有名单、续做、重复交卷、跨账号和旧180题会话。
- 真实隔离API浏览器通过：从UI开始180题、保存退出、真实API准备长草稿、UI续做并完成最后一题自动交卷、桌面1440/手机390的全部10个题号逐一回看、历史重开及重复交卷快照一致，180题复盘完整。成功API未mock。
- 独立复审发现未答回看仍可操作的缺口；新增生产回调浏览器先以enabled断言失败，再统一锁定和中性解析。最终真实历史中的单选、多选、配对未答不计分题均只读、确认隐藏、答案和解析可见；配对无可拖候选。
- report与show-answers浏览器通过。后者两个过时的答题卡入口选择器更新为当前真实悬浮入口，没有更改断言意图。
- pnpm test：404项、Python契约9项、部署门槛4项通过；test:design 5项通过。所有修复后复审通过。
- 418与候选的bundles/practice-lobby.css、styles/practice-mode.css逐字节一致。原1274个site文件全部保留，只新增两个浏览器测试文件，共1276。
- 首屏仍2个脚本；新增说明不进入大厅首屏，也没有新增整卷题干/答案到目录响应。
- 证据：artifacts/pmp-unscored/中的backend-red/green/final.log、readonly-red.log、browser-three-types.log、report-browser.log、pretest-note-1440/390.png等。

## 发布状态

已部署v9.0-p4.1.419，实现提交691c2d2f。用户尚未验收，main保持6941af5c，保留功能分支。

## 实际发布与公网复核

- update-uat.sh退出0，完整release验证1628秒、总部署1694秒；validation.json为passed=true、profile=full，active pointer指向419，site1276文件。
- 正式验证包含backend的`cd backend && .venv/bin/python -m pytest tests/ -q`：1311通过（3条既有弃用警告），frontend的`cd frontend && pnpm test`：404通过，以及全部要求的浏览器/视觉检查。新PMP真实API浏览器与报告5个Node用例均在正式候选上通过。
- 公网7种视口（1504×801、1366×768、1280×768、1024×768、768×844、390×844、320×568）仍通过首屏2脚本/12摘要、整页固定、桌面一屏、按钮对齐、窄屏操作可达及向上规则提示，无JS错误。
- 公网practice-lobby.js、practice-report.js、practice-lobby.css的SHA256均与419候选逐字节一致。UAT后端容器内practice_scoring_service.py和practice_session_service.py的SHA256与已测源码一致，确认实际部署实现。
- HTTPS健康status=ok、db=ok；脚本确认PUBLIC_RELEASE_OK=v9.0-p4.1.419。证据uat-verification.json、uat-backend-hashes.json、uat-health.json及uat-deploy-419.log。
- 最后以只读数据库投影核对published PMP的实际题量：当前没有180题整卷；公网搜索“模拟”只有PMP模拟卷A（185题）。按用户确认的范围，该卷不启用本规则；没有擅自删去原卷5题、扩大适用范围或回算历史成绩。
- 业务计分/名单/回看已在隔离真实API和候选浏览器上验证；公网复核是版本、资源、后端源文件与大厅检查，没有宣称使用UAT现有185题卷验证了180题业务。用户业务验收仍需准备一份180题PMP已发布卷并新开会话。
- 未合入或推送main，等待用户验收。
