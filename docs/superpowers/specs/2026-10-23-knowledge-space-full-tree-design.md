# 全知识树星空预览

用户最新要求：知识树全部节点进入星空，按做题数量结合关联知识点表现亮度，先看效果。本轮在当前工作区实现可运行本地预览；UAT 382 和 main 保持不变。

复用受登录保护的 `/api/v1/learning/practice/knowledge-universe`。该现有接口返回各 active 科目当前 published 知识树的所有 active 节点及当前账号有效作答映射，稳定 ID 和 parentId；无前端 60 条截断或业务分页。草稿与其他账号记录不可混入。

本次采用练习量亮度：未练 .12；关联有效作答越多越亮，`0.12 + 0.88 * min(log(1+n)/log(21), 1)`，20 次及以上达到上限。既有接口的熟练度字段/评分契约不改；展示层只将当前请求用于练习量亮度。每个节点的直接作答次数按 parentId 向祖先累加，每条路径各节点只计一次；分类节点包含后代练习量。保留 direct attemptCount，通过新 relatedAttemptCount 表示含子节点次数，详情明确文案，不将亮度称为掌握程度。原数据不回写、不改判题。

全量树未练节点也显示暗星，初始缩小视图保留全部真实星点作为底图，再叠分类名称和节点数；放大查看/选择节点，分类按钮和详情列表继续可用。没有有效作答但有知识树时仍可看星空；无已发布知识树才显示目录为空。顶部紧凑统计全树/已点亮/作答数，删除“30天新鲜度”和旧分页文案。已有大画布、移动端、滚动、旋转、双指缩放、关闭/重开/刷新、账号隔离、Canvas列表降级保留。不会增加自动播放假数据或模拟用户成绩。

验证包括数量与亮度单测、父子汇总/循环/不修改输入、完整树超过60节点、0作答、刷新、失败重试、切账号、桌面/手机真浏览器缩放与点选、1000节点性能，以及已有相关契约。使用真实本地知识树/API展示预览，若展示亮度差异的隔离样例，必须明确标注样例而非用户作答。补齐前一请求的三组 UAT 人工验收清单，区分 UAT382 与这次本地预览。

## User visual feedback: enlarge the star network itself

The user rejected the running sample on 2026-10-23: “星空图的大小太小了”. Increase the initial and reset visible star/edge network footprint inside the existing large canvas. For the actual published317-node catalog at1440x960, target at least70% canvas width and75%height with point centers inside a safe margin. For390px retain at least75% width without clipping/overflow. Use responsive spacing/projection/fit as evidence warrants; do not merely enlarge shell or blindly zoom/crop. Explicit camera gestures still persist until reset. Add a real rendered-bounds regression for actual catalog shape (public snapshot may live as named testfixture), preserve320/1000 performance and all lifecycle interactions.

## User visual feedback: lower canvas layer under text

The user additionally requests “星空图的层级可以稍微放下一层，一些其他文字可以叠放在上面”. Put the scene as a lower visual plane across the main shell; header/title/summary and existing details/groups/camera/help may overlay above rather than consume a separate large header band. Preserve existing controls, readable text, accessible close, actual foreground clicks, blank-canvas gestures, mobile native vertical scroll and Canvas-failure normal-flow fallback. Keep source changes scoped shared dashboard/scene/CSS; no unrelated restyle. Verify desktop/mobile rendered geometry and real clicks, not only z-index values.

## User visual feedback: remove top demo and close bands

The user highlighted the full close row plus root-added brightness demo toolbar as unwanted. Remove the reserved full-width close band; float the existing accessible44px close button at top-right above foreground. Header/title/summary/refresh must not overlap it at1440/559/390, and close/Escape/focus/fallback remain usable. Root removes standalone demo toolbar entirely and labels sample brightness in small bottom text; no sample practice data is persisted or presented as real owner history.

## User follow-up: spacious details, edge placement and zoom-aware text

2026-10-23 user requests: (1) current expanded topic list/detail is too small; put all information into a spacious popup; (2) screenshot arrows move summary/refresh upward and camera/help downward; (3) add 显示文字 so all node names can appear, with aggregation and hiding as zoom decreases.

Keep the enlarged full-tree background, practice-volume brightness, floating close and no demo toolbar. Reuse one detail/list DOM in a native modal above the star dialog: desktop wide list/detail areas, mobile spacious stacked content, internal scrolling, selected title/path/direct+related counts/date and previous/next. Clicking a star or 考点详情与列表 opens it. List selection updates same selected node; close/Escape returns to star without closing it. Parent close, data refresh/error, account change and pagehide close/clear child popup. Own focus restoration and avoid outer focus trap handling child Tab/Escape. Canvas failure still provides functional list access; guests/empty never expose stale private rows. No duplicate detail state or IDs.

Align summary/refresh at the upper right near the top edge, reserve floating-close space. Anchor camera buttons/help near the lower-right edge of the visible star dialog rather than to an interior content block. Category controls and bottom explanation remain readable/clickable and do not collide with dock at1440/559/390. Small screens may wrap compactly with native scrolling; no new top band or shrunken canvas.

Add 显示文字 toggle with aria-pressed. Enabling must visibly reveal detailed node labels (advance to existing detail zoom if the scene is in cluster overview), without changing node identity/data. Labels for all visible nodes must be represented, either individual text when space allows or screen-space grouped labels with exact member counts; do not silently take the first N. Aggregation should be deterministic and readable, and members remain selectable at sufficient zoom/list. At middle scale show semantic category/group labels; below0.75 of fit zoom hide canvas text. Existing detail/clustering boundary1.35 remains unless tested evidence needs a coordinated change. Toggle off removes ordinary detailed labels while keeping existing category/selected context; far zoom hides all canvas text. Labels must not overlap unreadably, overflow viewport or fabricate knowledge links. Large1000-node responsiveness and existing picking/rotation/fit remain. UI preference only, no business storage or backend change.

Validate real rendered labels and physical interactions: popup full list/details, long content/mobile, list selection/prev-next, child Escape vs parent Escape/focus, repeated open/close/refresh, account/error invalidation, Canvas failure; upper/lower bounding positions and collision-free controls; toggle true/false, zoom individual->aggregate->hidden, aggregate membership coverage,1000-node cost. Sourceonly then sync for local preview, no UAT/main deployment.

## User-approved visual redesign: classification constellations and unified bottom dock

2026-10-23用户明确同意上一轮视觉评审建议：“就按你说的改，保留全部知识节点和大画布，把分类星团、连线和底部布局整理好，改完先给我看效果。”该批准覆盖本次视觉调整，无需重复设计确认。本轮仍只更新本地效果预览，禁止部署UAT/main。

目标是能直接辨认分类结构、有主次、留白和完整构图。保留全部真实已发布节点、练习量亮度口径、目录关系、3D探索、大画布和上一轮详情大弹窗，不靠删除未练节点或截取前N个换取简洁。

- 星空：沿现有groupKey分类，使同类节点形成有明确间隔的星团；PMP人/过程/环境在默认及复位视角可辨认。分组布局应可推广至多个科目、任意分类数量及1000节点。分类间的父子弹力不能将各星团拖成同一个线团。组内节点有局部组织和受控深度，分类中心、真实节点身份和父子边不变；初始/复位仍完整容纳图，用户旋转/缩放后不强制重排相机。
- 星点：普通未练点显著缩小、减弱，保留可见性；练习点更亮，选中点有克制的金色强调。分类锚点用紧凑名称/数量而非大圆盘遮挡下级。分类名称在正常概览、以及文字关闭的常用细节视角仍有锚点；低于0.75fit隐藏全部Canvas文字的规则保留。
- 连线：保留真实model边；概览里默认轻淡，不让长线贯穿全屏抢夺注意力。细节/选中时强调相关真实关系（不造连接），非当前关系退后。点击选择、分类导航与完整列表仍能到所有节点。
- 文字：已有显示文字、语义缩放和完整代表成员数量继续可用。密集标签按分类/屏幕邻近聚合，标签贴近所属节点/星团，避免固定格子中等距排列和跨图长引线；精确保留visible成员覆盖，无first-N截断，不能混淆不同科目分类。
- 构图：Canvas仍覆盖整个弹窗底层，不恢复宽侧栏/大顶栏，不变成小图。标题和底部工具背后用局部渐隐保持可读；主星团初始构图有安全边距、不会默认被窗口切掉。
- 底部：复用原分类导航和视角控件，组成贴近可见弹窗真实底边的一组工具区。桌面分类左、视角右；窄屏上下排/分类横向可滚，44px点击目标、无横向整页溢出。不要在2/3高度留下横穿画布的分类分隔线和长说明。帮助和亮度解释收为同区域可展开的简洁说明，复用原文/ID和DOM而非复制；对键盘、点击、关闭均真实可用，底部固定工具不挡列表弹窗。总节点数只保留一处视觉统计，样例身份继续明确，不把样例当成绩。
- 兼容：owner迟到请求保护、刷新/错误/空目录、Canvas失败列表、详情子弹窗焦点/Escape/滚动、关闭重开、普通纵向滚动和触控手势不回退。

验收：使用真实317目录样例，1440x960、1280x720、559x854、390x844及短390x568观察概览/文字开/选中/弹窗。截图必须能看出星团间隔、小星点、弱连线和贴底工具；不再以功能通过替代视觉判断。先为分组分离/全量成员/近邻标签/底部位置补失败行为检查，再实现；运行现有Node、dashboard/semantic/scene浏览器（含1000性能）以及根控制器同步后的预览/前端契约。只在当前功能分支写源，生成文件仅由root同步，VERSION及active release不变。
