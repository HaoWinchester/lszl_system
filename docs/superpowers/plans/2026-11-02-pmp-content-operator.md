# PMP 内容运营工具实施计划

> For agentic workers: use executing-plans to implement and verify this plan.

**Goal:** 交付本机单用户知识图文生成、审核和持久化发布队列工具；真实平台连接未验证时明确阻断，不冒充已运营。
**Architecture:** tools/xhs-operator 独立 FastAPI 服务、SQLite 状态机、GLM Anthropic 兼容客户端、Playwright 卡片渲染与持久浏览器适配器、原生管理页。
**Tech Stack:** Python 3.11 / FastAPI / SQLite / httpx / Playwright / HTML/CSS/JS。

## Global Constraints

- 与做题系统数据库、前端、发布链路完全分离；不恢复旧定时任务。
- 凭据运行时只读 ~/.claude/settings.json 的相关字段，不落库、不输出。
- PMI 官方来源逐条保存、校验来源摘要；不把公开简介说成完整教材。
- 真实账号登录、身份与发布页面须实测；不绕过验证，不虚构发布、统计或学员体验。
- 09:00/20:00 上海时区，暂停持久化，错过时段不补发，提交未知不重试。
- main/uat 永久分支保留；开发自检不是用户 UAT 验收。

## Tasks

- [x] 1. tests/test_store.py 先验证持久暂停、领取互斥、提交未知、改稿失效、排期不补发；实现 operator_app/store.py。
- [x] 2. tests/test_content.py 验证缺来源、答案冲突、重复文案、产品夸大与溢出阻断；实现 sources.py、content.py、render.py；实际连接 GLM 并生成预览。
- [x] 3. 实现 browser.py 持久账号连接、明确身份检查、填写与结果核验；tests/test_worker.py 验证暂停、异常与不重复提交；worker.py 实现循环与通知。
- [x] 4. server.py / static/ 实现来源、队列、预览、设置、启停、诊断与告警；tests/test_api.py 验证回环访问、CSRF 和编辑状态。
- [x] 5. README、启动/暂停命令与独立依赖；执行 pytest、真实模型/渲染/管理页测试，记录真实平台是否完成及阻碍。用户验收前不合 main。

## Verification record

2026-11-02 开发验证：

- 独立工具 pytest：27 passed；JavaScript 语法检查、Python 编译检查通过。
- 仓库 `pnpm --dir frontend test`：383 Node 契约、9 Python 契约和4组 UAT 部署脚本测试通过。首次运行因新工作树缺少 `artifacts/` 目录失败；创建预期目录后重跑通过，未修改测试规避失败。
- 真实 GLM 已完成两篇审核通过的六图稿件，第二篇经历一次事实审核拦截和自动重写；一次实际发布成功，笔记 ID 为 `6ae838fc0000000016018ebf`，已保存平台发布列表截图与回执。
- 本机服务重启后仍暂停，浏览器登录和账号 ID 可复用，无需再次扫码。
- 前端已检查内容列表、六图预览、独立审核、队列与设置。后端学习系统数据库测试未执行，本改动不触及其业务。
- 真实评论/私信适配、持续知识扩库和竞品自动采集未交付；不能把首版发布链路称为完整无人运营。
- UAT 地址 http://127.0.0.1:8877 ，代码合入/推送 UAT 后等待本人业务验收，不合 main，不恢复旧 Codex 定时任务。
