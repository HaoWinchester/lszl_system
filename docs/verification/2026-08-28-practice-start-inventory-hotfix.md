# 正式站 start 422：已发布试卷选题修复

用户确认：已发布试卷按现有题目正常练习，领域配比只在新组卷时校验，优先恢复线上做题。这替代旧设计中“开始练习时领域不足必须拒绝”的规则。

## 原因与修改

- 旧入口重新强制按 42/50/8 抽题。考试卷 03 有人 83 / 过程 92 / 环境 10，选择 180 题时要求环境 14 而报 `PRACTICE_DOMAIN_SHORTAGE`；考试卷 04 有过程 101 / 人 84 / 环境 0，小题量也被拦截。前端将结构化错误显示成“试题读取失败”。
- 上一轮只检查了部署、健康、资源和未登录权限，没有用真实试卷覆盖开始请求，是验收缺口。
- 仅修改共享后端 `practice_session_service._select_questions`：按发布顺序或固定随机种子，从冻结题目中取指定数量；不重新按领域组卷。`domainTargets` 记录实际选中数量，未知分类仍标为数据不完整。
- 挑战、学霸、普通练习统一生效。总题量不足仍返回 `PRACTICE_QUESTION_SHORTAGE`；新组卷/发布严格预检、评分公式、发布快照、原有会话和经验结算未修改。

## 测试与实际数据验证

- 先新增/调整 11 个选题与开始用例，旧代码下全部失败，复现领域不足 422 或未保留发布顺序。
- 定向回归：`test_practice_question_selection.py`、`test_practice_sessions.py`、`test_paper_releases.py`、`test_paper_release_publish_payload.py`，**80 passed**。覆盖顺序、随机稳定性、不重复、总题量不足、三模式开始/保存/恢复、新发布预检。
- 后端全量：`.venv/bin/python -m pytest tests/ -q`，**624 passed，243.43 秒**，1 条既有 python_multipart 弃用警告。报告测试显式安排前 10 题的 4/5/1 分布，保留冻结分值的原有断言，不依赖开始时重新组卷构造夹具。
- 在服务器实际恢复本次生产备份到一次性 PostgreSQL 15 库，数据库网络为 `none`，测试应用仅共享该隔离网络命名空间。临时学员只创建于副本，通过真实 FastAPI 登录/start/abandon 接口验证两套问题试卷 × 三模式 × 10/20/60/180 × 顺序/随机，**48 组全部返回 200**；检查题目数量、唯一性、题干/选项/答案可用。验证容器与卷均已删除。
- 上线后用正式容器代码和正式库只读事务，遍历 **13 套可练习发布卷、82 组选题**全部通过。考试卷 03/04 的 180 题顺序和随机均可取满。
- 48 组认证 POST 是隔离副本测试，82 组是正式库只读选题核验；没有在真实用户账号上新增试答，不将这两项称为线上用户登录作答回归。

## 备份与部署证据

- 服务器备份目录：`/home/ubuntu/lszl-backups/20260828_174654_practice-start/`，目录 `700`、文件 `600`。私密内容未下载到本地。
- `app-runtime.tar.gz` 19,446,036 字节；`db.dump` 40,204,411 字节；`external-config.tar.gz` 3,150 字节；`backend-image.tar.gz` 104,228,853 字节。全部 SHA-256 通过，数据库归档完整解码并用于上述实际恢复验证。
- 旧镜像保留为 `lszl-kg-backend:rollback-practice-start-20260828_174654`。本次无新迁移，若只回退此次代码，应保留现有库，不应覆盖上线后的有效数据。
- 应用提交 `bd0a2fabb9eac8be532ec4c4c4ca413ae8cd1b7c`，已快进合入、推送 main 并删除功能分支。
- 北京时间 2026-08-28 17:54:48 开始切换，17:54:53 健康恢复。新容器 `22d609a39261`，镜像 `sha256:0a775f78ddfbdbc0d4fd53b53de6ee222bc6524bc5ed747998acdcab8ebb216b`，与隔离 API 测试所用镜像相同。
- 后端全部 160 个 Python 文件与 main 一致，相比前版仅上述 service 变化，SHA-256 为 `5b589ea62e3428f1ccd55ce6cf157f7d8a008df83d41817bdd6adf16860c3f22`。
- 前端 active 指针和全部 973 个文件未变，仍为 `v9.0-p4.1.186`。这是后端修复，无需清浏览器缓存，未手工改写 release site。
- 数据库 head 仍为 `a8c1d4e7f920`，数据库容器、卷、`.env.prod`、Compose 配置和 UAT 均未变。公网/18086 健康检查通过，上线后所查日志无 ERROR、Traceback 或 HTTP 500。

本地日志：`/tmp/practice-inventory-red.log`、`/tmp/practice-inventory-focused-green.log`、`/tmp/practice-inventory-full-green.log`。服务器备份目录保留 `real-api-check.json`、`production-readonly-verification.json`。
