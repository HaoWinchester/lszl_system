# 大厅第五版生图提示词

用户要求直接生成 UI。修订要点：删除底部重复的最近学习及续练区域，保留四种独立模式和各自入口，仅保留左侧历史导航与右上角继续上次。通过内置 image_gen 编辑第四版，保存为 practice-lobby-v5.png，旧版保留。只生成设计资料，未修改业务代码。

Refine this existing Chinese practice-lobby design into a finished, polished, simpler product UI. Output ONE horizontal 16:10 desktop application screen. The user explicitly wants a generated design, not advice.

MANDATORY CORRECTION: completely REMOVE the entire bottom “最近学习” heading, recent-paper row, 8/20 progress, and lower “继续” action. Do not replace this area with any panel, metrics, illustration, chart, tips, footer navigation or other filler. History is already in the left navigation; resume is already in the top-right “继续上次”. These are the ONLY respective entrances on this screen. No repeated history or resume controls.

PRESERVE ALL FOUR original modes with independent names, concise purposes, rules-help ? icons and their OWN entry buttons:
“普通练习” / “开始练习”
“挑战模式” / “开始挑战”
“学霸模式” / “进入学霸模式”
“复仇模式” / “开始复仇”.
Never convert them into tabs, segments, dropdown modes, or one shared action.

Keep the thoughtful visual hierarchy of the reference: ordinary practice as the left primary card; Challenge and Scholar as two white cards at upper-right; Revenge as its own horizontal card below them. Keep paper library with EXACTLY THREE compact paper cards across, search, subject, free/member filters and “更多”. Keep slim sidebar with “开始练习”“学习记录”“我的收藏”“学习报告”“账号设置”. Keep top product name “知识练习”, top right “知识图谱”, help, avatar. Replace the test account name “UAT助手验收teacher” with a neutral short user label “学习者”; no test strings in the finished design.

Improve the execution instead of adding things:
- White and very pale neutral-gray background; dark ink Chinese text; one elegant restrained violet #7155e8 primary accent. Blue/amber/rose only in tiny mode-icon backgrounds or tiny status hints. NO gradients anywhere, no glowing fills, no oversized shadows.
- More precise typography: 26px page title, 18–20px card titles, 14px descriptions, 12–13px secondary labels, regular/medium weights. Do not make every label bold. Keep comfortable real Chinese reading sizes.
- Tighten the library so paper cards are only about 80–90px high with title and ONE metadata line. No paper progress bars. Selected paper indicated with a thin violet outline and small radio, subtle pale fill.
- Reduce oversized icon blocks in the modes to 36–40px. No huge decorative icon tiles.
- Remove “日常巩固” eyebrow above “普通练习”; the title and one description are sufficient.
- Place ordinary practice count and order in one compact row, “题量 10题 ▾” and “顺序 试卷顺序 ▾”, with a well-proportioned violet start button below. Card should feel efficient, not an empty billboard.
- All advanced-mode action buttons use quiet outline styling, with violet only for text/border; ordinary's button is the one filled primary CTA.
- Challenge description “整卷闯关，检验掌握程度” and small rule hint “答错扣血”.
- Scholar description “限时作答，训练判断速度” and small rule hint “答对加时 · 连对回血”.
- Revenge description “重做错题，巩固薄弱知识点”; its count “12道错题待复习” is a small muted rose text hint, not a loud red alert. Own entry button stays visible.
- Use uniform 10px corner radii, thin #e4e6ee borders, subtle alignments, 20px gaps. Main content max width and padding consistent. Keep card bottoms aligned. Four-mode composition total about 320–350px high; shorter than source to balance the screen.
- Right-side tiny context line under mode heading can say “当前试卷：综合练习 01”, no redundant selected-paper panel.
- After removal of recent learning, let the layout end cleanly below the four modes with intentional modest breathing space. No excessive blank ocean and no invented content to fill space.

The result should read immediately: choose a paper, choose one of four recognizable study paths, begin. It should feel like a designed and shippable learning product, neither an administrative form nor a marketing landing page. One screen, no collage, no explanation labels, no watermark.

