# 全量知识星空与弹窗滚动设计

用户已明确确认：无法上下滚动发生在知识星空弹窗内；全部知识点采用“全部已发布知识树（推荐）”，未练暗色、练过变亮，支持科目筛选。该确认修正此前仅展示已练考点的范围，本次不再要求重复批准。

当前实现只聚合当前账号练过的冻结考点，UI和场景再截取60条。UAT只读核验当前发布知识树PMP317节点，CSPM/ACP/NPDP各1，共320；这些数字只用于现场验真，不能硬编码为业务数据。大厅访客1440×900/1440×650/390×844真实wheel可滚动；弹窗Canvas却对所有wheel preventDefault并touch-action:none，与纵向滚动冲突，旧测试只断言滚轮缩放而未覆盖用户在Canvas区域滚动。

数据由数据库中active科目当前published知识树的active节点完整构成；复用current_taxonomy解析有效current指针及已发布版本回退，不重复历史版本，不泄露草稿/归档。增加受CurrentUser保护的GET /api/v1/learning/practice/knowledge-universe，返回完整nodes与当前账号真实有效作答overlay。原knowledge-dashboard历史分页接口保留兼容。共享服务复用冻结作答有效性/owner聚合，只按确切taxonomyId+primaryNodeId匹配当前发布节点，不按题目文字猜考点，不借用其他用户。未匹配历史数据计数明确保留。

新节点字段兼容scene已有nodes，增加parentNodeId及稳定parentId、subjectId、taxonomyTitle、practiced；已有id/title/subject/taxonomyId/primaryNodeId/path/attemptCount/lastPracticedAt/brightness。目录节点ID由taxonomyId/nodeId稳定生成。未练brightness=.12、日期null/次数0；练过亮度最终按下述已确认综合熟练度计算（取代初版时间亮度）。返回topicCount/practicedTopicCount/unpracticedTopicCount/attemptCount/recentAttemptCount/unknownAttemptCount/unmappedAttemptCount/subjects/brightnessMeaning/now，无静默条数截断。父子连线来自当前知识树，缺失或循环路径防御处理不猜测其他树。

前端一次读取完整universe，保留owner/generation清理和迟到响应守卫，移除可见分页及slice60。支持全部/科目筛选（可复用现有分组按钮），显示总量/已练/未练及选中节点练习详情；零练习也展示暗色完整知识树，零目录明确提示未发布知识树。安全textContent和Canvas失败列表降级保持。

Canvas移除60硬上限，短距离排斥改为三维空间分桶邻域，保留有界迭代、稳定停止、后台暂停、reduced-motion、destroy、相机与选择契约；完整320及1000节点测试确保不裁数据且可交互。优先使用parentId父子边；旧形状无父引用的独立调用可保留原组织fallback，不能替换真实树边为假业务关联。

交互：普通滚轮/触控板在Canvas上默认上下滚动弹窗；Ctrl/⌘+滚轮或双指缩放调整视角，现有+-按钮保留。鼠标拖动旋转；触摸纵向滑动滚屏、横向拖动旋转、双指缩放；pointercancel不误选。弹窗采用明确可滚动内容区，关闭操作始终可达，不能滚动背后大厅。1440×900、1440×650、390×844、320×568真实wheel/触摸及关闭后大厅恢复需要测试。

只改当前工作区权威new-legacy及必要后端服务/API与测试；不安装依赖、不动其他大厅暂缓项、订阅规则或schema。按任务独立审查、最终全分支审查、官方full新版本、备份后部署UAT；main不变，等用户本人业务验收。

## 用户追加确认：熟练度决定亮度
用户明确“亮的程度要不一样，越熟练越亮”，并选择“综合计算熟练度（推荐）”：最近正确率、连续答对和有效练习次数共同计算，持续答对变亮、答错回落。仅用于学习反馈的“练习熟练度”，由真实服务端已完成练习的判题记录计算；正在进行的练习只更新已练次数、不通过星空提前透露未结算对错。界面说明“完成练习后更新熟练度”。未被判题的旧记录不伪造正确率。
每知识点保留按服务端acceptedAt（旧有效submittedAt回退）排序最近20条已完成且correct为bool的有效判题，使用稳定sessionId/questionId处理同时间顺序，内存有界；跨冻结path/科目标签变体以精确taxonomy/node合并。N条样本，A=正确/N，S=尾部连续正确次数，C=.25+.75*min(N/10,1)，P=round(100*(.8*A+.2*min(S/5,1))*C,1)。N=0尚未评估；未练.12，已练brightness=round(.2+.8*P/100,4)，待评估已练.2。完全未练、待评估、待巩固(<40)、逐渐熟悉(40..<75)、较熟练(>=75)有清晰说明。例：1全对27.3分、5全对62.5、10全对100；错误使近期准确率/连对下降，不用时间新鲜度替代熟练度。
节点新增proficiencyScore(null可表示待评估),proficiencyLevel,gradedAttemptCount,correctCount,recentGradedAttemptCount,recentCorrectCount,recentAccuracy(null可表示无样本),correctStreak。新universe brightnessMeaning='practice-proficiency'，移除旧活动亮度dimAfterDays；旧历史dashboard接口仍按既有新鲜度契约。前端展示熟练度分值/近期正确率/样本数，空样本不能显示成“0%正确率”。

## 用户追加纠正：多题归纳画笔不得顺带重排
用户指出多题归纳画笔换行/拉宽未获授权，原先重设计要求只针对临时相关画布。已明确承认范围扩大，恢复多题归纳原有紧凑画笔与颜色排列；只按最新确认隐藏已有图标按钮文字并保留悬浮中文提示/无障碍名称。禁止进一步重设计。恢复范围按计划Task5，其他页面默认视觉、已实现dialogs/theme/保存/草稿保护保留。
