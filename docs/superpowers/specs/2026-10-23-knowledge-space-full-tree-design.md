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
