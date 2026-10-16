# 知识卡片详情操作精简 Implementation Plan

> **For agentic workers:** Use executing-plans to implement the following single scoped change and requesting-code-review before UAT integration.

**Goal:** 隐藏知识图谱卡片做题入口，移除设为连线起点按钮。
**Architecture:** 局部修改10-graph-editor.js既有详情DOM/绑定与question-batch-controller.js提示，复用已有抽屉能力。

- [x] 定位现有入口和依赖测试；按用户明确指令实现hidden与移除DOM/绑定。
- [x] 共享测试助手验证隐藏/去除并支持保留内部能力回归，迁移原抽屉/模板/批量测试调用。
- [x] 真实隔离浏览器检查、独立审查、同步版本336并核对文件清单，标准full候选门禁。
- [x] 合入uat、代理推送、标准部署及公网资源/页面只读核对，等待用户UAT。
