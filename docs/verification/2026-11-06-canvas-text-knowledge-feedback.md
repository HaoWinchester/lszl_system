# 画布文字缩放与知识星空反馈

状态：v9.0-p4.1.426 完整发布门禁通过，正在准备 UAT 部署；用户业务验收待执行。

## 用户需求与实现

| 需求 | 原因与改动 | 开发验证 |
| --- | --- | --- |
| 多题画布新增文字后缩放跳动 | 输入框是 body fixed 浮层，视口 180ms 缩放动画只同步首帧。共享文字控制器在编辑期间监听 world transform，每帧重新锚定，保存/取消时解绑。 | 原代码横向最高 46px、纵向 58px 偏移；修复后原生 wheel 逐帧偏差小于 1px。保存态 wheel/按钮的世界坐标和字号尺寸不变。 |
| 隐藏左右/上下滚动条 | 共享输入框仅隐藏原生滚动条，保留 overflow:auto 和光标滚动。 | 横向长行、纵向多行仍可输入/移动光标，保存文本完整。 |
| 知识点增加连线 | 数据已有 313 条真实父子边，未练习透明度仅 .07。基础线调整为 .24、练习路径 .48，不改布局、节点、线宽或字体。 | 五种窗口实际 Canvas 验证真实父子边、基础可见性、亮度层级和分类筛选。 |
| UAT 查看知识点亮效果 | 现有 UAT 发布题的旧考点或缺失引用无法映射当前 PMP 树。新增仅 UAT 可用、默认 dry-run 的专用造数 CLI。 | 18 个真实叶节点、156 次带当前知识映射的测试作答；1/5/20 次覆盖三分类，祖先按真实口径累加。其他用户不变、重跑不重复、密码不重置。 |

亮度表示节点及下级累计练习次数，20 次及以上最亮，不表示掌握程度。测试数据明确标记为演示记录，只存在于专用学生账号 `uat-knowledge-demo`；不修改现有用户、题库或发布卷，不发放成长奖励，不在前端硬编码点亮。

## 专项验证

- `cd frontend && pnpm test` 基线：421 项 Node 契约、9 项运行契约、4 组部署脚本通过。
- `cd frontend && pnpm test:design`：5 项通过。
- `python3 new-legacy/tests/canvas-ink-polish-browser.py`：22 项真实浏览器用例通过；根智能体独立重跑新增 animated_text_anchor、hidden_text_scrollbars 两项通过。
- `node --test new-legacy/tests/canvas-text-box.test.js`：7 项通过。
- `python3 new-legacy/tests/canvas-text-zoom-browser.py --base-url <disposable fixture> --source`：真实多题页 wheel/按钮缩放、输入焦点、数据库保存/刷新、重新编辑取消通过。
- `python3 new-legacy/tests/canvas-text-persistence-browser.py --base-url <disposable fixture>`：首页、深度回忆、多题画布通过，包括 IME、503 草稿保留/重试、撤销/重做。旧用例以当前 activeWorkspaceId 代替已失效的写死 ID，原业务断言保留。
- `node --test new-legacy/tests/knowledge-space-scene.test.js new-legacy/tests/knowledge-dashboard.test.js`：34 项通过，根智能体独立重跑通过。
- 知识场景 original（五尺寸）、scene（桌面/手机 320/1000 节点）、semantic（三尺寸）浏览器检查通过。
- `cd backend && .venv/bin/python -m pytest tests/test_uat_knowledge_demo.py tests/test_knowledge_universe.py tests/test_knowledge_dashboard.py tests/test_uat_learning_feedback.py -q --tb=short`：28 项通过，含 6 项新增造数测试。
- 两部分共享前端修改和造数工具均经过另一智能体独立审查，无阻塞发现。尚未新增双并发 apply 的专项执行测试；事务锁与单事务路径已审查。

## 完整发布门禁

`node frontend/scripts/manage-new-legacy.js update new-legacy --validation-profile full` 退出 0，完整门禁耗时 1731 秒：后端 1333 项、前端 421 项、9 项运行契约、部署与扩展契约、做题、知识星空、画布、课堂登录恢复、跨功能数据和学习资产浏览器检查全部通过。视觉差异：练习桌面/手机与自由图谱手机 0%，自由图谱桌面 0.001%。没有跳过验证或降低检查等级。

源内容哈希 `b966fb46868e8312ad2ae895b3c2cd31cb6b655bc6e89a4f12fd44b90752e996`，site 哈希 `b358aef1cdb4e43c53d0b6e6506e1380219e938895f076aa056b3c2c1516ac11`。验证中产生的两处未跟踪 Python 字节码已恢复为被验证输入的相同字节，未修改任何产品源码；后续管理命令设置 `PYTHONDONTWRITEBYTECODE=1` 防止生成物漂移。

## 发布保护

- UAT 发布前备份：`/home/ubuntu/lszl-uat-backups/20261106T040413Z-canvas-knowledge`。代码包 54011194 字节、数据库 dump 36387866 字节；非空、tar 与 pg_restore 目录、SHA256、manifest 已校验。保留旧镜像标签，不删除既有备份。
- 当前 UAT 425 包共 1287 文件；426 候选共 1288 文件，无丢失路径，admin-console.html 存在。三处实际修改资产与权威源逐字节一致。
- 本工作区原 active 指向旧 420。将工作区内已完整验证、哈希与实际 UAT 相符的整个 425 不可变包导入原先不存在的版本目录（不覆盖或编辑 site），前后校验 source/site 哈希及 1287 条实际路径；通过官方 promote 425、再官方 update 426 重新执行相对 425 的文件/协议门禁并复用成功完整验证。最终 `previousVersion=425`。复用报告保留首轮旧 420 gate，额外 425 门禁证据见 `align-baseline.log`、`restore-uat-baseline.json`，未修改历史验证报告。
- 初始 main 为 `6256275850e25c30cd7f3c696167c9d779122a46`；本次仅允许合入和部署 uat，用户明确验收前不合入 main。
- 原有 docs/design-previews、docs/local-preview、docs/promo 均保留；为避免无关本地素材影响发布上下文，临时本地排除项将在收尾时恢复。
- 本地证据目录：`artifacts/canvas-knowledge-feedback/`。私有登录信息与密码不提交、不输出到日志。
