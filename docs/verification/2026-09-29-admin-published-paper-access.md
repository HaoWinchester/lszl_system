# 管理员登录后试卷目录为空

本地版本 v9.0-p4.1.262。

## 根因与修复

本地两份已发布试卷均设置 allowedRoles=[student]。目录按当前登录角色过滤，管理员因此被排除；共享访问判断与开练入口也重复执行受众限制。

管理员现在可检查已发布试卷，目录、冻结题目读取、前端发布试卷解析和开练使用一致权限。开练删除重复角色判断，继续依赖公共 can_access。其他角色仍遵守发布受众和会员限制，发布状态、学习模式与数据 owner 校验保留。未修改试卷受众数据、既有用户密码或部署环境。

## 验证

- 新增失败回归后修复：管理员访问仅面向学生的免费/VIP 试卷，目录、详情、题目和普通开练均成功；无会员学员仍不能读取 VIP 内容；不在受众中的教师仍被拒绝；撤回后管理员目录和读题也不可见。
- 后端 test_practice_unseen、test_paper_releases、test_question_materials：35 项通过。
- 前端主检查 301 项 Node 契约、运行时 Python 契约、部署脚本模拟检查通过；设计契约 5 项通过。
- 真实本地 FastAPI/PostgreSQL 和 Chromium：使用独立管理员账号遍历 practice-mode、knowledge-recall、question-workspace，三个共享仓库入口均返回两份目录并成功解析 23 道冻结题；做题大厅实际显示两张卡片，点击普通短练成功进入 10 题会话。
- 截图已检查。验证账号已归档、浏览器已关闭，没有操作用户当前浏览器会话。
- git diff --check 通过。未运行后端全量测试，保留既存 python_multipart 弃用提示。

本地预览进程已更新：http://127.0.0.1:5179/practice-mode.html 。使用隔离数据库 kg_experience_20260928 和本地 fallback 同步产物，未 promote、未部署 UAT、未推送或合入 main。

日志与截图：artifacts/learning-experience/admin-papers-*（本地忽略产物）。
