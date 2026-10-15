# 弹幕设计落地与 UAT 验证（2026-10-16）

用户已批准 `docs/design/danmaku-2026-10-16/concept.png`，本次在现有共享评论模块落地头像、暂停状态、作者/时间/关闭、四个线性图标动作及更多菜单。沿用现有评论 API 与偏好存储，不涉及数据库迁移。

## 设计来源和像素对照

原稿由内置 `image_gen.imagegen` 直接生成；工具没有返回模型 ID，不能把它写成已验证的 GPT Image 2 元数据。原始提示和 provenance 已与原图一起入库。

按原稿 3× 组件导出解释，设计条高约 44—45 CSS px、浮层约 287×196 CSS px。比较采用 Chrome DPR3、1440×1000 视口中 418×418 CSS px 的固定区域，输出与原图相同的 1254×1254 像素。仅冻结弹幕动画坐标，保持实际组件 CSS、SVG 图标、文本和尺寸；无图片缩放、扭曲或像素遮罩。页面题目保持可读，原稿的虚化背景不应用于产品。

- 原图：`docs/design/danmaku-2026-10-16/concept.png`
- 页面截图：`docs/design/danmaku-2026-10-16/design-actual.png`
- 原图/截图/4倍差异并排：`docs/design/danmaku-2026-10-16/design-comparison.png`
- 差异数值：`docs/design/danmaku-2026-10-16/design-comparison.json`
- 重现：`python3 docs/design/danmaku-2026-10-16/compare-design.py`

真实做题页 CSS 顺序及 body 主题属性下，无遮挡全图差异像素（任一通道差值 >24/255）为 **8.7543%**；平均通道绝对误差 **11.7457/255**。浮层区域差异像素为 **9.4871%**。这不是通过阈值，也不代表已完全还原。

对比仍存在字体栅格、图标路径、时间格式、弹性条宽及背景差异，不能宣称像素完全一致。源与 active release 的一致性是另一项发布检查，不代替本对比。

## 真实 API 与交互

`python3 new-legacy/tests/run-danmaku-api-browser.py` 使用新建、迁移、销毁的隔离 PostgreSQL/FastAPI 服务；成功响应均由真实服务提供。10 组验证：答前抑制、短留言/他人优先/最多8条、点赞和取消及重挂载、收藏和取消及私有列表、单次503恢复、带 parentId 回复、显示/隐藏偏好跨刷新、换题及390px更多菜单、跨作者/私题403及游客401、登出清理与游客登录入口。页面错误为0，服务退出0，检查对应临时库无残留。

最终共享浏览器回归 7/7，包含恢复真实18秒CSS动画后，点赞/取消点赞/收藏/取消收藏和错误刷新持续暂停、关闭/Esc/空白恢复、已关闭或销毁后的异步响应不重开。独立审查发现的实际页面皮肤覆盖和暂停归属问题均已修复并复审通过，无未处理重要问题。

额外回归覆盖关闭/Esc/空白、顶部/底部翻转及 resize、真实图标、HTML转义、减少动态偏好、评论抽屉、侧栏和收藏隔离。

## 发布

335候选标准 full 门禁已通过（939秒）：后端1068、前端335、Python契约9、部署脚本4、扩展契约10及完整浏览器回归通过。334候选因审查发现暂停回归而主动中止，未promote，未部署；UAT仍保留333。本地和UAT容器实际active均为335，previousVersion为333。标准update-uat.sh部署成功（38秒），部署提交为 `eb81438586e415879a025cd643360216b22d881d`。远端deploy-state与此提交一致。正式环境与 main 不变；开发自检不替代用户 UAT 验收。


- 发布地址：https://uat.aihuanpu.com/practice-mode.html
- 容器site文件数1137；与旧active1133相比仅新增4个测试文件，无文件删除，admin-console等关键页面均在。
- 公网健康status/db均ok；10项JS/CSS/SVG资源与本地实际active逐字节一致。
- Chrome访问4个游客页面版本均335，页面错误0；1440桌面和390手机以只读合成GET留言预览真实公网弹幕模块、CSS和SVG，操作格radius0、shadow none、transform none，更多不越界，Esc正常关闭。所有UAT写请求本地阻止；业务持久化已在隔离真实数据库验证。
- 公网检查：`python3 artifacts/danmaku-image-design/public-smoke.py`；结果`artifacts/danmaku-image-design/public-smoke.json`，截图同目录`uat-v9.0-p4.1.335-1440.png`和`uat-v9.0-p4.1.335-390.png`。
- 发布记录：`artifacts/danmaku-image-design/deploy-335.log`，候选验收：`frontend/new-legacy-releases/v9.0-p4.1.335/validation.json`及`validation-run.log`。
- main及origin/main保持`0f86fabdeca98379ec50753b793b74a915671677`。保留main、uat和功能分支，等待用户本人UAT验收；未合入main。
