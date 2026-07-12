# 模块化扫描与本次重构说明

## 当前模块化程度

项目已经完成了基础模块化：

- 首页、题库管理、考题训练、深度回忆、用户管理、系统设置已经拆成独立 HTML 页面。
- 全局能力已经逐步抽出：
  - `src/19-home-toolbar-registry.js`：首页工具栏配置与 handler 注册。
  - `src/33-user-center.js`：用户中心弹窗。
  - `src/34-role-permissions.js`：角色、权限和主题。
  - `src/39-global-shortcuts.js`：全局快捷悬浮栏。
  - `src/36-system-settings.js`：系统设置页面。
- 题库、训练、深度回忆等业务也已经拆成独立模块文件。

## 本次低风险重构

本次没有重写业务逻辑，优先做“减少重复、清理迁移残留”的低风险重构：

1. 新增 `src/31-admin-utils.js`
   - 统一提供后台/系统页面常用工具：
     - `escapeHTML`
     - `readJSON`
     - `writeJSON`
     - `uid`
     - `fmtTime`
     - `logAction`
     - `roleLabel`
     - `statusLabel`
     - `refreshRoleUi`
     - `toast`

2. 重构 `src/36-system-settings.js`
   - 系统设置页开始使用 `KGAdminUtils`。
   - 减少系统设置页内部重复工具函数。
   - 保持角色主题、微信登录、权限模板、日志等功能不变。

3. 清理 `src/35-user-management.js`
   - 移除系统配置迁移后残留的角色主题和微信配置相关函数。
   - 用户管理页继续聚焦账号管理、批量操作、权限展示和日志展示。

4. 清理 `user-management.html`
   - 移除不再需要的 `src/32-wechat-login.js` 引用。
   - 微信登录配置已经迁移到系统设置页。

## 仍建议后续继续优化的方向

### 1. 题库管理继续拆分

`src/65-question-bank-admin.js` 仍然较大，建议拆为：

- `question-bank-store.js`：题库/试卷读取保存。
- `question-bank-render.js`：列表、分页、表单渲染。
- `question-bank-paper.js`：试卷管理。
- `question-bank-cognitive.js`：关键词、知识点、推理链。
- `question-bank-import-export.js`：导入导出。

### 2. 首页工具与闪卡继续拆分

`src/20-flashcards-toolbar.js` 同时承担工具栏、闪卡、学习包 ZIP、样式控制等职责，建议拆为：

- `home-toolbar-actions.js`
- `flashcards.js`
- `learning-package.js`
- `canvas-style-tools.js`

### 3. 权限与认证进一步统一

`30-auth-guards.js`、`72-question-training-page.js`、`32-wechat-login.js` 和 `33-user-center.js` 的用户读取/保存、密码校验、会话写入和日志写入已优先接入 `KGAuthCore`。用户管理已完成第五步 A/B：`35-user-management.js` 负责页面渲染与交互，新增的 `35-user-management-service.js` 负责创建、更新、密码、状态、复制、删除、批量操作和导入导出数据处理。后续可继续拆分认证 UI 与会话编排层：

- `auth-modal.js`
- `auth-session.js`

### 4. 历史文件清理

`legacy-single-file.html` 与 `docs/combined-for-parse-check.js` 已从当前整理版中移除，正式开发基线不再依赖这两个文件。

## 本次验证

- 已通过全部 `src/*.js` 语法检查。
- 检查活跃页面未发现重复 ID。
- 系统设置权限 `accessSystemSettings` 已接入。
- 用户管理页已移除配置页签和配置逻辑残留。



## 第六步脚本加载顺序整理

活跃页面已经统一使用 `defer` 加载本地脚本，并按核心层、全局层、页面层排序：

- 核心层：`29-auth-core.js`、`34-role-permissions.js`、`37-subscription-core.js`
- 全局层：`32-wechat-login.js`、`33-user-center.js`、`39-global-shortcuts.js`
- 页面层：图谱、训练、题库、深度回忆、用户管理、系统设置等具体业务脚本

特殊说明：`index.html` 中 `30-auth-guards.js` 会包装 `openNodeModal`、`createNodeAt`、`applyNodeSize`、`applyLineColor` 等首页函数，因此必须放在 `10-graph-editor.js` 和 `20-flashcards-toolbar.js` 之后，而不是与 `29-auth-core.js` 一起提前加载。

## 订阅功能前置设计

本次新增订阅核心模块 `src/37-subscription-core.js`，作为后续订阅功能的统一入口。

订阅边界：

- 管理员 `admin`：系统管理角色，自动绕过订阅限制。
- 教师/教研 `teacher`：教学与题库维护角色，自动绕过订阅限制。
- 学员 `student`：唯一进入订阅权益判断的角色。
- 游客 `viewer`：内部 role key 保持不变，但 UI 文案显示为“游客”；不进入订阅体系，仅保留公开示例体验。
- 未登录 `guest`：访客状态，不进入订阅体系。

页面或按钮后续如需订阅限制，应统一使用：

```js
window.KGSubscription.canUse('featureName')
window.KGSubscription.requireFeature('featureName')
```

不要在各业务文件中直接判断套餐字段，避免订阅逻辑散落。

## 第七步：订阅模型校准

订阅核心 `src/37-subscription-core.js` 已从早期占位模型 `free_student/basic_student/pro_student` 校准为正式商业模型：

```text
free / monthly / quarterly / half_year / lifetime
```

旧套餐 ID 保留自动兼容映射，避免已有本地订阅数据失效。系统设置页的订阅套餐展示已同步改为四档套餐，并补充有效期、推荐标记和用量摘要。详细记录见 `docs/SUBSCRIPTION_MODEL.md`。


## Step 8B 订阅申请流程

`src/37-subscription-core.js` 已新增订阅订单存储与申请处理 API；`src/33-user-center.js` 负责学员端提交申请；`src/36-system-settings.js` 负责管理员确认开通 / 取消申请。详见 `docs/SUBSCRIPTION_STEP8B.md`。


## 基线重构 B 模块审计补充

- 新增 `src/28-app-storage.js`：统一本地存储安全读写、删除、更新、keys 查询和迁移辅助。
- `KGAuthCore` 已优先通过 `KGAppStorage` 读写用户、会话和日志数据，同时保留原 API。
- 订阅、权限、系统设置、用户中心、全局快捷入口、首页图谱保存、引导、字体缩放、深度回忆进度等低风险区域已接入统一存储入口。
- 题库管理大文件暂不整体迁移，建议在下一次题库功能调整时单独拆服务层。


## 基线重构 C 模块审计补充

- 新增 `src/21-home-package-service.js`：学习包 ZIP / JSON 文件格式服务，承接原 `20-flashcards-toolbar.js` 中的 ZIP 打包、解析和下载逻辑。
- 新增 `src/22-home-file-library.js`：首页用户文件库本地服务层，提供按用户隔离的图谱记录增删改查 API，暂不改变现有首页 UI。
- 新增 `styles/home-file-library.css`：为后续“我的图谱 / 用户文件库”面板预留样式基线。
- `src/20-flashcards-toolbar.js` 已移除学习包底层 ZIP 处理函数，仅保留导入 / 导出时连接首页 state、sanitize、render 和 showStatus 的薄封装。
- 首页脚本加载顺序已插入 `21-home-package-service.js` 与 `22-home-file-library.js`，保持 `30-auth-guards.js` 在工具栏动作注册之后加载。


## 基线重构 C-1 / C-1.1 补充

- `src/23-graph-file-store.js`：图谱文件、当前文件、分类标签、旧单图谱迁移。
- `src/24-graph-file-autosave.js`：dirty 状态、3 分钟定时保存、切换与离开前保存。
- `src/25-graph-file-tabs.js`：固定宽度文件页签、文件切换、新建图谱、保存状态显示。
- `styles/graph-file-tabs.css`：独立文件页签栏和画布浮动工具栏布局。

## 基线重构 C-1.2 补充

- 新增 `src/41-account-menu.js`：首页右上角账号胶囊下拉菜单，统一连接用户中心、帮助中心、登录与退出。
- 新增 `styles/account-menu.css`：账号胶囊、下拉菜单、键盘焦点和移动端布局。
- 首页登录状态文案简化为“用户显示名 / 访客只读”，不再展示登录前缀和角色名。
- 外置“使用说明”和“退出”按钮改为隐藏兼容触发器，原有业务 API 和事件绑定继续可用。
- `33-user-center.js` 仅在首页账号菜单标记存在时让出点击入口，其他页面仍保持原用户中心入口行为。
