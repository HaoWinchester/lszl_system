# 大厅控件与卡片做题弹窗局部调整

## 用户授权范围

1. 移除做题大厅“全部科目”筛选框及无用UI状态/绑定。
2. 搜索框在既有工具栏内向右对齐，保留搜索/清除/免费会员筛选及分页。
3. 开始练习按钮与题量/顺序控件保持37px等高。
4. 复仇规则图标位于卡片右上角，与挑战/学霸对齐。说明优先向上浮出，窄/矮视口限高内部滚动，不增加页面高度或改变滚动位置。
5. 按用户截图重设计知识图谱卡片做题弹窗；保留全屏、关闭、题目关联维护、三类题型、服务端判分/解析、失败重试和常驻more大厅入口。其他页面样式不在本次调整范围。

## 实现

- 复用practice-answer-page.js提供公共提示定位，标准帮助/复仇共同调用。标准帮助保持既有悬停与resize行为；页面滚动仅更新复仇提示，弹层内部滚动不重定位。
- 提示固定定位，先选择上方空间，不足时保留视口内可读性。禁用定位属性的隐式过渡，避免全局reduced-motion极短transition导致位置跨帧变化。
- 规则面板支持Tab聚焦、键盘内部滚动；Escape隐藏后恢复问号焦点，内部焦点不会触发误关。
- 图谱题目使用独立题卡、题型/序号、字母选项选中态及主次操作。更改仅作用于graph-question-drawer和gqd命名空间。
- 提交的冻结快照、requestId幂等、owner epoch、权限与API请求保持原流程。判分取服务端attempt.correct；选项正确/错误提示仅在授权analysis返回后展示。
- 独立审查发现checked规则覆盖结果色，已提高结果规则优先级，并用真实浏览器检查已选选项及字母块的提交前后颜色确实变化。

## 开发自检

- 原fidelity新增检查先复现科目控件未移除，再验证1440/768/390/320宽度下搜索右对齐、三个控件等高、规则图标相同内边距、提示向上且不增scrollHeight/scrollY。
- 390×480矮屏验证Tab进入规则、End滚动内部且不滚动页面、Escape回焦点。
- practice-catalog-search-browser、practice-side-nav-comments-browser、practice-answer-sheet-browser与完整practice-demand-loading浏览器通过，后者仍为首屏2脚本/12摘要及所有失败重试/历史/旧链接/owner隔离覆盖。
- 图谱真实FastAPI/PostgreSQL隔离数据库回归通过：teacher/admin/student/member/viewer、单选/多选/配对、图片权限、搜索关联/删除、409/503恢复、实际按钮进入/退出全屏且保留答案、手机末题操作和more跳转。所选正确/错误选项的结果色覆盖选中态已验证。
- graph-question-drawer单测3项通过；前端404项及Python9/部署4门槛、design5项通过。最终发布管理器会再次运行要求的完整校验。
- 独立代码复审通过；复审未代替root真实浏览器自检。

## 预览与发布

- artifacts/practice-ui-polish/graph-practice-mobile.png与graph-practice-desktop.png使用真实弹窗组件和用户截图转录的中文视觉样例；这些仅用于外观预览，未假装成真实API成功用例。
- 真实业务回归日志graph-browser-final.log、answer-sheet-browser.log、lobby-controls-keyboard.log等位于artifacts/practice-ui-polish/。
- 候选v9.0-p4.1.417，待完整发布、健康及公网复测后记录成功。用户本人UAT验收尚未执行；main禁止提前合入，功能分支保留。
