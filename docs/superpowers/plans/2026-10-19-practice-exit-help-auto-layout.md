# 弹幕退出清理和两项交互修复计划

用户已授权修复三项、测试通过部署 UAT；大厅其他暂缓需求不动。

目标：退出做题不残留弹幕；挑战/学霸帮助支持悬浮、键盘和点击；思维导图参数变更自动应用且可撤销。

架构：复用练习 `setView` 的统一视图切换入口、现有答题页公共展示模块和思维导图公共控件。保持现有 API、权限、保存及历史模型，不引入依赖或数据库变更。

## 任务和验证

- [x] 在 `new-legacy/tests/practice-side-nav-comments-browser.py` 补退出清理、取消退出和重新进入回归；在该浏览器流程补两个模式帮助 hover、焦点、Escape、外点和点击覆盖。先运行观察原缺陷失败。
- [x] 在 `new-legacy/tests/graph-mindmap-browser.py` 改为选择方向/根节点/范围后立即检查真实节点位置，移除旧按钮点击，补无选区失败、撤销/重做和重开持久化。先验证自动应用在原实现失败。
- [x] `src/100-practice-mode.js` 在离开 game 时销毁 danmaku 来源；共享评论模块清理自建宿主，防迟到请求重建。只在成功视图切换时清理，取消或保存失败继续答题。
- [x] `src/practice/practice-answer-page.js` 统一绑定现有 `.practice-lobby-help`，复用同一 hover/focus/click/关闭逻辑。保留原帮助正文和布局，修复点击与 focus 自动打开冲突。
- [x] `src/graph/mindmap-themes.js` 删除应用按钮，方向、根节点、作用范围 change 调用既有布局事务。打开面板不写入；无选区只提示，不移动全图；每次成功操作可撤销。更新另外两个引用旧按钮的浏览器用例。
- [x] 运行定向单元、实际 API 隔离库浏览器、前端及设计契约；复核 diff 保持大厅范围。执行官方 release full 门禁并核对候选文件数及关键页面。
- [x] 合入并推送 uat（命令级代理），部署前备份 UAT 当前代码和数据库并校验非空。标准脚本更新 UAT，核对公网版本、资源哈希、运行容器及正式环境未变化。保留功能分支、main 和 uat，等待用户业务验收。

主要命令：`python3 new-legacy/tests/practice-side-nav-comments-browser.py`；隔离测试服务运行 `graph-mindmap-browser.py --base-url ...`；`pnpm --dir frontend test`；`pnpm --dir frontend test:design`；`node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`；正式 full 门禁使用标准 UAT 发布脚本管理。
