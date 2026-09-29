# 小程序练习覆盖统计与下一轮短练

范围：对应网页端已有能力，补齐小程序试卷列表的本版本已练/未练统计，以及结果页直接开始下一轮最多 10 题普通练习。仍只在本地验证，不上传、不部署。

实现：
- 复用目录 API 的 coverage 和版本绑定的练习进度 API。共享服务校验 releaseId、非负整数及总数一致性；缺失统计不伪装成零。
- 列表与结果页使用同一统计文案；结果页重新读取保存后的统计，不使用开练前冻结的 selectionSummary 推断当前进度。
- 结果页直接进入现有设置页并自动开练，复用开始/继续/明确放弃重开流程，不增加第二套创建会话实现。全卷不足 10 题时按全卷数量；已全部练过显示“再复习”。仍保留原来的自选模式新一轮入口和错题复习入口。
- 统计请求失败保留报告并提供重试，未知题量时不自动开练；跳转失败可以重试，重复点击不重复跳转。

验证：
- `cd miniprogram && npm test`：316 passed，含新增 6 项服务与页面行为测试（版本隔离、缺失统计、请求失败与恢复、直接开练、少题量、已有会话、取消与重试）。
- `cd backend && .venv/bin/python -m pytest tests/test_mini_client_login_flow.py -q`：1 passed。执行真实小程序 Page/service 模块，连接真实 FastAPI 与临时 PostgreSQL；覆盖完成练习后目录/结果统计刷新、直接开下一轮、全练过后复习、回收新会话。微信身份供应商及运行容器使用测试替身。
- `cd backend && .venv/bin/python -m pytest tests/test_practice_unseen.py tests/test_practice_question_selection.py -q`：17 passed，覆盖未做优先及选题规则。
- 微信开发者工具内置 `wcc` 编译全部 22 个 WXML：exit 0；`wcsc` 编译修改的 paper-list-item 样式：exit 0。
- `git diff --check` 通过。

未验证：开发者工具 CLI 报告 IDE service port disabled，未运行模拟器交互/截图，也未做真机或用户 UAT 验收。编译与接口测试不替代这些验证。未修改开发者工具安全配置、API 环境地址或任何部署状态。
