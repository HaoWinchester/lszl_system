# Task 7 report — 阅读双击与临时拖动

任务完成于本地；实现基于4844ad3d（当前HEAD额外704cb3e1仅Task6审查文档）。只修改权威源与本任务测试；root额外授权最小30-auth-guards共享只读入口修正。未修改主题、页面布局、VERSION、active pointer；未发布、部署或接触普通5180用户数据库。

## Implementation / self-review

- 10-graph-editor原knowledge-card dblclick处理器：reading选择目标卡、清理其他选择，再调用原openRelatedCanvasModal；其他模式仍startNodeInlineEdit。第二个text-element dblclick处理器逐字保留。按钮、链接、表单、contenteditable（包括plaintext-only）、inline-editor与resize后代保持独立处理。reading的updateCardQuickActions始终hide，不再放行grip mini-toolbar。
- related-canvas-controller仍传readOnly=!canWriteGraph；只移除临时卡拖动的readonly短路，并保留readOnly内容工具/快捷键/画笔限制。临时连接分支仅editable可用。拖动使用原viewport.scale换算、session geometry/history/renderer更新连线；pointercancel与lostpointercapture回滚该次拖动、清空transaction并释放捕获；正常up提交临时history。
- 实际viewer被30-auth-guards的cardsLayer capture dblclick先拦截。新增单一authCanOpenReadingRelatedCanvas predicate，仅已登录+reading+实际卡牌+非交互后代放行至原保护入口。stage capture原isUI(card)已return，无须复制判断或放开空白画布创建。guest、其他模式、交互后代与正式API权限均保留。
- 既有openRelatedCanvasModal保存/草稿恢复、generation/file switch/单例保护与temporary session复制机制未改；未引入source override、持久化临时工作区或新依赖。

## RED commands / actual failures

```sh
node --test new-legacy/tests/v91-related-canvas-reading-mode.test.js > artifacts/knowledge-universe-20261020/task-7/unit-red.log 2>&1
node frontend/scripts/sync-new-legacy.js > artifacts/knowledge-universe-20261020/task-7/sync-red.log 2>&1
PYTHONDONTWRITEBYTECODE=1 python3 artifacts/knowledge-universe-20261020/run-related-api.py --output-dir artifacts/knowledge-universe-20261020/task-7/red > artifacts/knowledge-universe-20261020/task-7/browser-red.log 2>&1
node --test new-legacy/tests/v91-related-canvas-reading-mode.test.js > artifacts/knowledge-universe-20261020/task-7/auth-red.log 2>&1
```

- 初次unit有效RED：5项中3失败（reading toolbar未hide、reading dblclick未open、旧readonly拖动规则/提示不符），2项原ink/CSS约束通过。首个测试最初缺UI边界stub导致ReferenceError，已完善stub后重新得到真实断言失败；unit-red.log保留有效轮。
- 实际浏览器RED：reading单击后node-style-toolbar仍visible，class含show readonly-context。截图red/reading-single-click.png与red/failure.png。fixture PID19501，testExit1，fixtureExit0，remainingDatabases=[]。
- auth RED：真实viewer reading双击无弹层（green-6失败记录），检查确认capture guard stopImmediatePropagation；新增定向测试在authenticated reading noninteractive case得到true !== false。随后最小共享修正。
- 早期误用backend虚拟环境执行浏览器helper时报缺Playwright；改用已有系统python3，无安装。所有Python执行设置PYTHONDONTWRITEBYTECODE=1（一次早期纯文件编辑heredoc漏写该环境变量，不import项目、未生成bytecode）。

## GREEN commands / results

```sh
node frontend/scripts/sync-new-legacy.js > artifacts/knowledge-universe-20261020/task-7/sync-green-final.log 2>&1
PYTHONDONTWRITEBYTECODE=1 python3 artifacts/knowledge-universe-20261020/run-related-api.py --output-dir artifacts/knowledge-universe-20261020/task-7/green-final > artifacts/knowledge-universe-20261020/task-7/browser-green-final.log 2>&1
PYTHONDONTWRITEBYTECODE=1 python3 artifacts/knowledge-universe-20261020/task-7/run-lifecycle.py --output-dir artifacts/knowledge-universe-20261020/task-7/lifecycle-final > artifacts/knowledge-universe-20261020/task-7/lifecycle-final.log 2>&1
node --test new-legacy/tests/v91-related-canvas-reading-mode.test.js new-legacy/tests/graph-temporary-session.test.js new-legacy/tests/v90-p4330-home-interaction-modes.test.js > artifacts/knowledge-universe-20261020/task-7/focused-green-final.log 2>&1
node --test frontend/scripts/design-contract.test.mjs frontend/scripts/practice-canvas-interaction.test.mjs > artifacts/knowledge-universe-20261020/task-7/design-green.log 2>&1
node --check new-legacy/src/10-graph-editor.js
node --check new-legacy/src/30-auth-guards.js
node --check new-legacy/src/graph/related-canvas-controller.js
git diff --check
```

全部上述命令exit0。focused11/11、design/interaction8/8通过；新API浏览器result.json PASS，15条结果（9次真实pointer drag加场景结论）。最终fixture PID30336，testExit0，fixtureExit0，remainingDatabases=[]。既有生命周期脚本独立fixture PID30334同样0/0、无残留数据库。run-lifecycle.py是artifact内复用同一helper生命周期、仅选择既有graph-temporary-canvas-browser.py的本地执行器，无测试mock或源码override。

| Requirement | Actual evidence |
| --- | --- |
| 阅读入口 | 真实API创建三卡两边图谱；hover和single click无toolbar、single显示详情；真实dblclick一次打开一跳a+b；无正文编辑/原图新建 |
| 交互后代 | 注入测试DOM的a/button/input/textarea/select/plaintext-only dblclick原target事件各1次、弹层0；不创建业务fixture内容 |
| 临时拖动 | reading a和原图locked b均可拖；scale1.15下屏幕80/40对应取整后world70/35；边path在按住期间改变；原图锁与位置均不改 |
| 缩放/cancel | 实际wheel后scale1.00877，a从470/335移动到549/375；pointercancel后恢复470/335，无history transaction、真实capture释放，后续mouse move不再移动 |
| 退出/重开 | close、Escape、原按钮CSS fullscreen切换都可用；重开a恢复400/300；连续synthetic dblclick stress只保留一个modal；实际初次入口使用真实mouse dblclick |
| 源/API隔离 | reading期间files POST/PUT/PATCH/DELETE为0；formal nodes/links序列化逐字相同，含locked字段；API graphData规范序列化完全相同；reload后a/b/c坐标仍400,300 /750,300 /750,550 |
| 编辑模式回归 | efficient/professional真实工具栏与双击inline editor保留；临时拖动、undo/redo、新增及pen真实绘制成功，Escape先退绘画再关闭；临时操作阶段0写，formal/API完全相同 |
| 实际只读 | ink-viewer真实登录、读取其真实持久化role-graph-ink-viewer；dblclick进readonly临时层、450/300拖到520/335；新增/删除/连线/undo/redo/ink控件不存在，Delete不删；重开还原；真正PUT /api/v1/files/{id}返回403，reload后API正文完全相同、canWriteGraph仍false |
| 两别名认证 | index.html、workbench.html分别真实viewer dblclick→drag→close，modal0写；efficient/professional双击仍无modal/inline editor；真实UI退出、打开登录弹框；不勾条款，使用fixture LEGAL_CONSENT_REQUIRED=false真实API登录后reload再核对身份与原图 |
| 生命周期/草稿 | 原graph-temporary-canvas-browser完整通过：scope、详情、ink文本/删除/键盘history、编辑/新增/连线、临时副本丢弃；等待保存产生新草稿成功/失败均保留、初始草稿失败恢复、flush失败拒绝进入、file switch/logout关闭清理 |

已视觉查看1440 viewer-drag截图：仅内容只读提示与适应/全屏/关闭；无新增工具栏。截图在green-final/，对应已通过前轮green-8/亦保留。

## Debugging / boundaries / known baseline failure

- 中间浏览器测试修正了过宽span/pen locator（toolbar内部同名span与viewport data-ink-tool也匹配）、world整像素取整容差，以及一处测试字符串引号。没有用这些setup错误调整产品行为或放宽数据/权限要求。
- 原direct-graph-adapter有400ms server-debounce force-save：在formal点击/inline取消后立刻开editable临时层，先前timer可能在层内再次写原正式快照。diagnostic/result.json记录真实persist堆栈reason=server-debounce，payload从未包含临时移动/新增。该既有适配层不在本次修复范围；编辑回归setup先等待原400ms保存与autosave clean，再开始modal零写计数。打开前原before-temporary save合法且保留；reading/实际viewer不做before-temporary写。没有声称修复所有未完成正式保存的timer边界，所有本次modal操作严格0写、源/API完全相同。
- `PYTHONDONTWRITEBYTECODE=1 python3 new-legacy/tests/shared-auth-dialog-browser.py > artifacts/knowledge-universe-20261020/task-7/shared-auth-browser.log 2>&1` exit1：index/practice两页登录/注册/退出/取消/重试功能流程均已完成，390视觉签名因fontFamily顺序不同失败（index PingFang在前，practice Microsoft YaHei在前）；其余当轮签名一致。该测试不加载本次auth-guards。
- 用`git show 4844ad3d:new-legacy/<file>`提取原测试及6个依赖（共7文件）到task-7/shared-auth-baseline/，运行`PYTHONDONTWRITEBYTECODE=1 python3 artifacts/knowledge-universe-20261020/task-7/shared-auth-baseline/new-legacy/tests/shared-auth-dialog-browser.py > artifacts/knowledge-universe-20261020/task-7/shared-auth-baseline.log 2>&1`，在相同行相同390字体签名exit1，证实baseline。未更改字体、主题或弱化该断言；944/1440视觉循环由于该失败未运行。该harness的法律勾选仅发生在set_content+fake auth的离线测试DOM，无真实账号法律提交；真实API浏览器始终不接受条款。
- 本轮drag取消使用浏览器派发pointercancel，真实鼠标移动/捕获与release经过实际浏览器；lostpointercapture独立意外丢失未另行实测。fullscreen验证原按钮的CSS全屏，不声称OS原生requestFullscreen。没有新增移动端手机编辑权限。
- 不跑全量pnpm/backend（无后端改动）；root统一最终同步/完整检查/本地预览。生成public/manifest/sync report保留未暂存交root。自检不代替用户UAT，未部署UAT或main。
