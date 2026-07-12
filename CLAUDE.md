# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

「通用知识点关系图谱工具」——纯前端、零构建、零框架的知识图谱编辑器，附带考题训练、题库管理、深度知识回忆、用户/角色/订阅管理等功能。所有数据存储在浏览器 `localStorage`，无后端、无数据库、无 npm 依赖。

本项目是从单个巨型 HTML 文件**低风险拆分**而来的模块化版本，目前仍在逐步工程化（参见 `docs/MODULE_AUDIT.md` 的「下一步建议」）。

## 运行方式

```bash
# 方式一：本地静态服务器（推荐，接近正式环境）
python3 serve.py
# 然后打开 http://127.0.0.1:8000/index.html

# 方式二：直接用浏览器打开 index.html 也可工作
```

无构建步骤、无 package.json、无 lint、无测试框架。改完源码刷新浏览器即可。

## 语法自检

没有正式测试套件。`docs/MODULE_AUDIT.md` 记录的验证手段是对所有脚本做 JS 语法检查：

```bash
# 逐个检查 src/ 下脚本的语法（脚本依赖浏览器环境，只能 check 不能 run）
for f in src/*.js; do node --check "$f" || echo "FAIL: $f"; done
```

## 架构大图

### 1. 不是 ES Module —— 靠全局变量通信

所有脚本通过 `<script defer>` 按固定顺序加载，文件之间通过**全局函数和全局变量**（共享闭包、函数提升）通信，**没有** `import/export`。因此：

- **文件名前缀编号（00–90）暗示加载顺序**，但真实顺序由各 HTML 里的 `<script defer>` 标签顺序决定——改顺序去改 HTML，不是改文件名。
- 跨文件调用的函数名（如 `load`、`render`、`$`、`uid`、`authLogin`、`openNodeModal`）是公共契约，**重命名会破坏其他文件**，不要轻易动。
- 启动逻辑必须放在 `src/90-bootstrap.js`（最后加载），因为原单文件依赖 IIFE 函数提升；拆分后启动动作只能等所有声明就位后执行。

### 2. 脚本加载分层约定

所有页面统一用 `defer`，并遵循「核心层 → 全局组件层 → 页面业务层」的顺序。**核心层必须先于一切业务脚本加载**：

```
核心层:    28-app-storage → 29-auth-core → 34-role-permissions
           → 37-subscription-plans → 37-subscription-orders
           → 37-subscription-redeem-codes → 37-subscription-core
全局组件:  32-wechat-login → 33-user-center → 39-global-shortcuts
页面业务:  各页面专属脚本（00-config-state / 10-graph-editor / 65-question-bank-admin / …）
启动入口:  90-bootstrap（仅首页）
```

**首页（`index.html`）有两个特殊顺序约束**（详见 `docs/SCRIPT_LOAD_ORDER.md`）：

- `30-auth-guards.js` 必须在 `10-graph-editor.js` 和 `20-flashcards-toolbar.js` **之后**加载——它会**包装**（wrap）首页的 `openNodeModal`、`createNodeAt`、`applyNodeSize`、`applyLineStyle`、`applyLineColor`，目标函数必须先声明。
- 文件服务层（`21/22/23/24/25-*.js`）必须在 `20-flashcards-toolbar.js` 之前；`41-account-menu.js` 在 `30-auth-guards.js` + `40-guided-tour.js` 之后。

新增页面时复用这套顺序；新增脚本时确认它在依赖的核心层之后。

### 3. 核心全局 API（挂在 `window` 上）

业务代码应优先调用这些统一入口，而不是各自直接读写 localStorage 或判断套餐字段：

| 全局对象 | 职责 | 关键 localStorage key |
|---|---|---|
| `KGAppStorage` | 统一本地存储读写/迁移（最先加载，其他核心依赖它） | — |
| `KGAuthCore` | 用户、会话、密码 hash、系统日志的统一核心 | `kg_local_users_v1`、`kg_local_current_user_v1`、`kg_user_admin_logs_v1` |
| `KGRolePermissions` | 角色权限模板与角色主题色；`can('xxx')` 权限判断 | — |
| `KGSubscription` | 订阅统一入口：`canUse()` / `requireFeature()` / `usageLimit()` / `setStudentSubscription()` | `kg_student_subscriptions_v1` |
| `KGGraphFileStore` | 图谱文件存储 v2（轻量索引 + 每文件独立正文） | `kg_graph_file_index_v2`、`kg_graph_file_content_v2__<owner>__<fileId>`、`kg_graph_current_file_v2` |
| `KGAdminUtils` | 后台页面通用工具（escapeHTML/readJSON/writeJSON/uid/fmtTime/toast…） | — |
| `KGUserAdminService` | 用户管理写操作服务层（增删改、批量、导入导出） | — |

`KGAuthCore` 是认证收敛的核心——`30-auth-guards.js`、`72-question-training-page.js`、`32-wechat-login.js`、`33-user-center.js`、`35-user-management.js` 的底层用户读写/会话/日志都已优先委托给它（迁移记录见 `docs/AUTH_CORE_REFACTOR.md`）。新写认证相关代码直接用 `KGAuthCore`，不要再造本地副本。

### 4. 角色与订阅边界（重要，勿越界）

**角色**：`admin`（管理员）、`teacher`（教师/教研）、`student`（学员）、`viewer`（游客，UI 文案）、`guest`（未登录访客）。

**订阅只对 `student` 生效**：`admin`/`teacher` 自动绕过订阅限制；`viewer`/`guest` 不进入订阅体系，仅保留公开示例体验。

- 套餐 ID：`free` / `monthly` / `quarterly` / `half_year` / `lifetime`；旧占位 ID（`free_student`/`basic_student`/`pro_student`）由订阅核心自动兼容映射。
- **业务文件不要直接判断套餐字段**，统一走 `KGSubscription.canUse('featureName')` 或 `requireFeature()`，便于后续接支付/后端校验。
- 权限入口统一走 `KGRolePermissions.can('accessUserManagement')` 等；只读用户的题库/用户管理入口会被自动隐藏。

详见 `docs/SUBSCRIPTION_MODEL.md`、`docs/SUBSCRIPTION_FEATURE_STEP8.md`。

### 5. 页面结构

7 个独立 HTML，每个按需引用 src/ 脚本（各页面引用的脚本组合不同，加脚本时记得同步到对应 HTML）：

| 页面 | 职责 |
|---|---|
| `index.html` | 主图谱编辑器（首页），最大，~29 脚本；含文件页签、闪卡、考题训练入口 |
| `file-manager.html` | 独立文件管理（网格/列表、文件夹、回收站、收藏标签、导入导出） |
| `question-bank.html` | 题库管理（题目/关键词/知识点/推理步骤标注、组卷发布） |
| `question-training.html` | 独立考题训练（含综合试卷） |
| `knowledge-recall.html` | 深度知识回忆「寻宝地图」（无限画布） |
| `user-management.html` | 本地多用户管理 |
| `system-settings.html` | 系统设置（角色主题、订阅套餐、卡密、微信登录配置） |

### 6. 图谱数据模型（`src/00-config-state.js`）

首页状态由全局 `state` 对象承载（`baseState()` 产出），含 `meta` / `viewport` / `defaults` / `nodes` / `links` / `flashReviews` 等。`makeNode()` / `makeLink()` 是节点与关系的工厂函数。旧 localStorage key `通用知识点关系图谱工具_多科目重点聚焦版_v2` 仍保留并镜像写入；新代码用 `KGGraphFileStore` 的 v2 接口。

## 维护约定

- **不破坏现有全局函数名和加载顺序**——这是模块间耦合的契约。
- 新增能力时，优先复用 `KGAppStorage` / `KGAuthCore` / `KGSubscription` / `KGRolePermissions`，不要在业务文件里重复实现本地存储、认证或套餐判断。
- 仍是大文件待拆分：`65-question-bank-admin.js`、`20-flashcards-toolbar.js`、`27-graph-file-manager.js`、`10-graph-editor.js`——改动时参考 `docs/MODULE_AUDIT.md` 的拆分建议，遵循「先建服务层、保留对外函数名、UI 行为不变」的低风险风格。
- 详细的模块职责、迁移历史、版本变更分别记录在 `docs/MODULE_MAP.md`、`docs/` 下各 `*_REFACTOR*.md` / `SUBSCRIPTION_*.md` / `FILE_MANAGER_*.md`，以及根目录 `CHANGELOG.md` 和 `README.md`——动到对应模块前先查相关文档。
