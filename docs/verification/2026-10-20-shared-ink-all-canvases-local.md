# 四处画布统一画笔（仅本地）

用户反馈知识图谱画笔仍是旧版，要求共用。根因：四个调用方已用同一绘制内核，但旧labelled是默认，compact/共享色板只在workspace与recall单独配置，遗漏主页和临时画布。

提交a411ebdf将公共94-canvas-ink默认统一为紧凑图标栏，移除labelled分支和两页compact特配，所有调用方色盘都在undo/redo之前。默认调用同一个KGColorPickerV2.openInk；workspace/recall保留自己的上下文/文档颜色参数，其他调用方自动继承。只有隔离消费者没有加载公共provider时保留native兼容。

主页/临时会话补getColorContext，沿原owner、文件切换、只读和销毁检查拒绝迟到选色。浮动窗口支持显式overlayHost，临时画布打开时重挂同一个root，关闭回home。事件在色板自身处理并阻止正式图快捷键；临时窗口捕获放行当前lease，HEX/方向键/Escape可用。dom-interaction.mountOverlay增加默认false的preserveSurface；先通过原独占全屏边界校验，仅保留属于当前全屏子树的显式未缩放弹层，避免z590色板被z10000临时遮罩挡住。其他调用默认行为不变。

## 验证

- controller真实DOM浏览器：默认compact先RED后GREEN；默认/显式provider、native兼容、owner/文件/关闭/只读/工具切换拒绝旧提交；真实原生全屏宿主先RED后GREEN，退出恢复通过。
- Node定向37项通过，包含笔迹序列化、坐标/文字、保存失败与导航恢复、只读、DOM独占全屏边界、阅读与临时画布。
- 真实隔离API主回归：workspace五尺寸、完整色板/颜色历史/鼠标及Enter/Space/SV/fullscreen/真实保存刷新/主题布局；viewer编辑禁用/API403；recall共享入口；主页和临时画布各五尺寸图标/色盘顺序/实际指针命中/HEX/方向键/Escape、绘画撤销重做、主页API保存刷新、临时关闭不写正式图、关闭后singleton回主页复用；另补主页原生全屏→临时→色板实际指针与键盘链路。最终fixture4394退出0，DB残留0。
- recall专项五尺寸、画笔颜色/撤销保存刷新、singleton lease接管通过，fixture99854清理空。阅读/临时画布role矩阵与API隔离通过，fixture99855清理空。
- pnpm test最终377Node+9runtime+4部署脚本门禁通过，design5通过；部署脚本仅测试，不是发布。
- 独立审查发现的临时色板键盘及原生全屏遮挡均已修复并复审关闭，无剩余P1/P2。
- HTTP健康、8项资源SHA/字节、三页独立cacheTag核对通过；星空源/主题模块与b8ad57b9完全一致。

本地地址 http://127.0.0.1:5180/index.html ，刷新后cacheTag v9.0-p4.1.378-local-a411ebdf。正式源/active release仍378，生成1231文件。仅画笔公共模块与必要浮层交互变化；页面主题布局及已恢复原版星空未动。无后端代码/schema变化，本轮未重复后端全量，业务验证用隔离真实DB，正常用户数据未用于造夹具。

未推送/部署UAT/promote/main/uat改动。用户本地明确确认后再准备UAT。证据 artifacts/shared-ink-20261020/：fullscreen-final-api/、recall-api/、role-api/、frontend-final.log、http-proof.json。系统EyeDropper跨窗口实际吸色仍未自动验证，滴管图标/共享色板其他真实操作已验。
