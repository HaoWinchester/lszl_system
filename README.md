# 幻谱学习系统

项目由 FastAPI/PostgreSQL 后端、原生网页端和原生微信小程序组成。网页端与小程序共用账号、发布试卷、做题会话、错题和订阅权限数据。

## 微信小程序

小程序源码位于 `miniprogram/`，使用原生 WXML、WXSS 和 TypeScript，不使用 WebView。它包含：

- 微信登录、绑定现有系统账号或创建账号；
- 试卷浏览、题量/顺序设置、普通练习、挑战模式和学霸模式；
- 单选、多选、双语题干、HTTPS 题图、答题卡、暂停恢复与离线草稿；
- 成绩报告、历史记录和“重答原题 → 阅读纠错 → 变式验证”错题复仇。

本地后端按 `backend/README.md` 启动后，用微信开发者工具导入 `miniprogram/`。游客 AppID 仅能检查部分页面；登录、预览和真机验收需使用已配置的测试 AppID。正式准备步骤见 `miniprogram/docs/release-checklist.md`。

## 自动检查

```bash
cd miniprogram && npm test
cd backend && .venv/bin/python -m pytest tests/ -q
cd frontend && pnpm test
```

小程序测试需要 Node.js 22.6 或更高版本；测试脚本已显式开启 TypeScript 类型擦除，Node 22 与 Node 24 均可执行。

自动检查不代替微信开发者工具编译、真机安全区检查和用户 UAT 验收。
