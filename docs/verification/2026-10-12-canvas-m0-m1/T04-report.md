# T04：缩放保存与文字栅格实验

## 实现与选择

- `RecallTransform.scale` 下限从 0.2 修正到 0.01，上限 4；有限值校验保留。先新增测试，观察 `.01` 被旧契约拒绝（RED），再修改字段，10 个模型／契约测试全部通过。
- 移除静止 `.world`、`.qw-world`、`.kr-world` 的常驻 `will-change:transform`；workspace CSS 由 workspace_m1 修改。保留首页原有交互期提示，回忆 `.smooth` 在已有动画结束清理机制内使用提示。
- **不修改两份共享 viewport controller**：目前 shared3D 在静止 auto 模式与 2D 几乎相同，而单独移除常驻提示已解决观察到的 DPR1 放大字形模糊。保持坐标与控制器现有算法是最短改动；不加入每帧 DOM 重建／重新排版。
- 检查回忆 payload、restore、zoom、公共 viewport 与 adapter：未发现二次 `.2` 最低值截断；前端仍支持 .01—4。此项不改变加载时既有居中策略。

## Chrome 实验

`python3 new-legacy/tests/canvas-text-clarity-browser.py` 使用已安装 Chrome（Playwright channel=chrome），加载 http://127.0.0.1:5189 三页的实际样式，待 `document.fonts.ready` 后替换 body 为受控中文 fixture；不写图谱数据。相同文本、字号、坐标与宿主 CSS，分别强制：shared3D 常驻提示、shared3D 结束后 auto、2D auto。它是**隔离栅格实验**，不是完整业务页面操作验收。

- 三页 CSS 环境 × DPR1/2 × 普通／真实元素 fullscreen × 1%、10%、20%、50%、100%、200%、400%、返回100%。共 288 张截图、288 次 elementFromPoint 中心命中检查，全部命中；另 36 组 60 帧 transform 更新计时。`text-clarity/results.json` 保存完整参数。
- DPR1 shared3D 常驻提示在 200／400% 明显呈位图放大边缘；结束后 auto 与 2D auto 字形恢复清楚。首页 400% 文本区域灰色边缘／墨迹比约 .7921→.1990；200% .8493→.3433。此指标只作固定文本配对佐证，不是通用清晰度评分。
- DPR2 对比没有观察到同等改善，400% 各方案灰色比约 .1345；不承诺所有设备都改善。
- 100% 和回到100%未观察到异常重影；1／10／20%未观察到异常缓存，但字形过小，**不声称每字可读**。
- 36 组 frameP95 中位数均约17.5ms，最大17.6—17.7ms；这是简单受控 fixture 的调度采样，不能证明大型业务图帧率。
- 额外回忆原生2D＋常驻提示 vs 原生2D auto 的400%截图：两者已清楚，未证明移除提示令该页中文字更清楚。回忆修改统一空闲合成策略，不能把 shared3D 结果套用于该页。

关键截图：

- `text-clarity/index-dpr1-full0-baseline-6-4.png`（模糊边缘）
- `text-clarity/index-dpr1-full0-interaction-only-6-4.png`（移除空闲提示）
- `text-clarity/index-dpr1-full0-2d-6-4.png`（2D，近似同上）
- `text-clarity/recall-native2d-baseline-400.png` 与 `recall-native2d-auto-400.png`（原生回忆2D对比）

## 验证与限制

- `cd backend && .venv/bin/python -m pytest tests/test_deep_recall_models.py -q`：10 passed；既有 python_multipart PendingDeprecationWarning。conftest 自动 createdb／迁移／dropdb，未使用业务库作测试写入。
- `cd frontend && node --test scripts/design-contract.test.mjs`：5 passed。
- `node new-legacy/tests/v90-p420-graph-kernel.test.js` 与 `v90-p435-home-edge-card-performance.test.js`：passed。
- 历史 `v90-p4517-deep-recall-large-graph-performance.test.js` 无法执行，依赖已不存在的 `knowledge-recall-p4517.css`；未改造无关历史测试。
- `--verify-idle` 检查当前 served candidate 的三页空闲 computed willChange=auto，必须在同步后运行；同步后完整324项执行通过。最初以 source CSS route 覆盖 homepage bundle 无效，已纠正为 served candidate 校验，不把那个执行当 source 验证。
- 尚未验证 Safari、浏览器页面缩放125%、完整业务卡片点击／拖拽、大型图浏览器帧率；这些留作后续联调／UAT。下述补充验证已经覆盖真实1%数据库 roundtrip。
- 无 sync、commit、分支切换或部署，由主智能体统一集成；本工作不授权 main。


## 补充：真实1%持久化／页面缩放125%尝试

- 使用 `backend/.venv/bin/python new-legacy/tests/helpers/canvas_ink_server.py --port 5192` 新进程加载修正后 schema；helper 自动创建／迁移独立 `kg_pytest_*`，教师 fixture ink-browser。未使用原5189旧schema进程，也未写业务数据库。
- `python3 new-legacy/tests/canvas-zoom-persistence-browser.py` **三页全部通过**：首页及归纳聚焦真实 range 控件按 Home；回忆既有补丁隐藏 range，改点真实减号按钮直至1%。三页百分比label=1%，DOMMatrix scale=.01；真实保存API均200；GET图谱／workspace／recall session得到存储scale=.01；页面reload后DOMMatrix仍=.01。
- 截图6张及真实响应状态：`zoom-persistence/results.json`、`{home,workspace,recall}-saved1.png`、对应reload截图。首页先正常关闭学习入口与新手引导弹层；未修改业务 state 注入缩放值。
- 125%浏览器缩放尝试：Chrome persistent profile Preferences 写 `partition.default_zoom_level=log(1.25)/log(1.2)=1.2239010857415449`；分别固定1440×1000 viewport及no_viewport＋window-size=1440,1000启动。Preference实际保留，但两个启动都得到devicePixelRatio=1、innerWidth=1440，**请求缩放未应用，当前启动方式不支持该验证**。`browser125/result.json`记录请求与实际值；截图`home125.png`只是失败尝试，不能标成125%通过。没有用CSSzoom或deviceScaleFactor伪造浏览器缩放。临时profile缓存已清理。
- 当前较新大图契约 `node --test new-legacy/tests/v90-p4529-deep-recall-large-graph.test.js`：library index缓存行为通过；controller源码正则断言失败，仍要求旧timer中`void writeProgressNow()`原文（recall改为串行queue保存），已通知主智能体处理归属；它也不等于真实浏览器大图帧率验证。
