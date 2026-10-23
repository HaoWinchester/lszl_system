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

## Visual tuning: larger clusters, slightly brighter stars

用户继续反馈：“星团还是有点小，中间空得太多了，再放大一些，星点也稍微亮一点，分类之间的间隔保留。”在现有已批准分类构图上局部调节，不重新设计底部或弹窗。本轮仍先本地看效果。

保留全部真实知识节点、当前分类中心布局/分类间隔、完整Canvas与边缘工具。优先将每个星团内部点相对所属分类中心的偏移放大约1.25倍（分类中心自身不挪动），相机初始/复位适配必须按同一套放大后位置计算，绘制/连线/拾取/分类定位共享坐标。适配后实际非单节点星团在317目录默认桌面图上应比当前增大至少约12%，目标15–25%；不以仅放大相机导致出界来达成，不让相邻星团混成一团。必要时微调安全边距，但保留前景文字、手机安全区、1000节点与手动相机行为。

星点展示alpha建议从0.38+brightness*0.58改为0.46+brightness*0.50，0.12练习亮度对应约0.52而非0.45；最高仍约0.96，练习量公式和存储不改，亮度次序保留。普通边仍轻淡，不同步提亮连线。其余标题、分类导航、说明、文字开关/缩放阈值、大详情弹窗和账号/刷新保护不变。

检查以真实317节点为主，比较修改前后每个非单节点星团的投影宽高/面积，保留分类间可见间距及初始/复位安全边界；桌面/559/390与短屏实图。补充或调整现有有意义的scene渲染检查，不新增镜像实现的测试，不重测无关业务。root同步、本地预览截图并做现有前端检查；不部署、不改VERSION、不动uat/main。

## Three-category composition and gentle auto rotation

用户要求：“把科目总览去掉，然后其他的把过程放在中间，其他两个放在下面，靠近一点，然后能不能缓缓的旋转”。直接授权本轮局部实现，仍先本地看效果，不部署UAT/main。

- “科目总览”是结构性的科目根，本轮从星空、分类导航和可见知识点列表中移除其独立展示，不改数据库/API或删除知识树数据。当前PMP目录317条含1个科目根，因此可见知识节点应为316，人62/过程235/环境19均完整保留。公共predicate只识别明确parentId:null且路径为科目自身的结构根；不得误删有真实类别路径的顶层知识点、无parentId旧形状或未命名数据。derivePracticeOverlay先按完整树计算，展示再排除结构根。scene/dashboard共享识别入口，不复制规则；真实父子边/索引必须与过滤后的数组一致。
- 当前三分类的“过程”居中上方/主要中心，“人”在下方左侧，“环境”在下方右侧，两个下方分类和过程都比原四宫格更靠近，但仍有清楚空隙。建议过程中心(0,0)、人(-180,300)、环境(180,300)作为初稿，按实际投影截图微调。过程居中按语义类别识别，不靠数组位置；其他科目或非三分类数据沿用通用确定性布局。大画布、此前星点提亮与体量、贴底工具、前景安全区、完整316节点和详情弹窗保留。
- 为保持上述位置，自动旋转采用各星团绕自身固定分类中心的轻缓自转（约8–10分钟一周），不是让整个构图绕屏幕转移。所有点/边/标签/拾取共用旋转坐标，分类锚点固定。初始/复位和持续旋转都要有安全空间；不能定时重排知识点或造边。若旋转影响相机fit，使用保守组内包络保证自动运动不裁切主要星团、不使类别混成一团。
- 通用scene mount可通过autoRotate选项启用，默认false保持其他调用/静态测试行为；dashboard默认开启。复用现有RAF，不另开永久interval；按真实时间推进、夹紧长时间间隔，避免恢复页面时跳转。drag/pinch/滚轮/手动视角与按钮操作时暂停自动自转，松开后约3秒恢复；持有指针不得持续空转RAF。展开考点详情期间暂停，关闭后恢复原自动选择；隐藏/关闭/切账号/destroy停止RAF和待唤醒timer，重新可见无跳跃。prefers-reduced-motion默认不开启自动旋转；用户可通过明确按钮主动开启，系统切换到reduce时停止并同步按钮。
- 增加真实可用的“暂停旋转/开始旋转”按钮，aria状态和可见文案反映用户开关，不因暂时交互暂停错误翻转。与现有操作说明共用底部次级工具行，避免把手机相机按钮挤成新的多行而压缩主要画面。暂停后没有自动动画帧循环；重置恢复构图与自转相位并保留用户自动开关。选中/阅读/键盘操作能保持稳定。
- 所有旧刷新/错误/空目录/owner迟到保护、Canvas降级、子弹窗Escape/焦点/长列表、普通纵向滚动、横拖/双指缩放保留。真实节点数变化必须同步统计、样例caption和测试期望，禁止仍标317却仅绘制316。

验证：新布局316点与三个名称/按钮、真实Process居中/两类下方/明显空隙；普通数据过滤边界；自动开启/进展速度、暂停/恢复、pointer/modal/hidden/reduce/销毁、帧和timer清理，实际点选位置随运动一致。旧scene默认静态无需弱化idle断言，新增明确autoRotate:true真实浏览器路径。用316实际目录与320/1000、1440/1280/559/390/短屏验证fit/性能和前景。前一版四宫格尺寸baseline不再适用于新构图，应改成当前布局/间隙/可见性回归，合理清理仅为旧比较而存在的fixture，保留其历史于Git。
