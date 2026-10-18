# 大厅第三、四版：产品判断与生图提示词

用户否决第二版，并要求保留原来的模式；进一步要求以产品设计师与 UI 设计师的专业判断设计。

第三版：保留四种独立卡片及入口，压缩周边重复配置，作为等宽卡片方向。

第四版（当前推荐，待确认）：普通练习作为默认日常入口；挑战突出整卷准确率，学霸突出限时速度；复仇根据真实待复习错题显示行动价值。通过非等权的卡片布局表达主次，保留四种模式各自的名称、说明、帮助和启动动作。普通题量/顺序仍仅属于普通练习；所有业务规则、权限、真实数据与接口继续复用原实现。

生成方式：内置 image_gen；参考现有大厅截图；本轮只生成设计资料，未修改业务代码。第一、第二、第三版保留，不覆盖旧图。

## 第三版完整提示词

Use case: ui-mockup. Create ONE new horizontal 16:10 high-fidelity desktop PRODUCT DESIGN SCREENSHOT redesigning the Chinese practice lobby shown in the supplied reference image. The reference is the EXISTING APPLICATION, use it as functional and identity reference. User rejected an oversimplified single-row mode selector and says the original modes MUST remain. Preserve FOUR DISTINCT, visually recognizable independent mode cards with their OWN entry buttons: “普通练习”, “挑战模式”, “学霸模式”, “复仇模式”. These four cards are the main visual identity. Do NOT turn them into tabs, radio segments, text rows, or one shared start button.

Goal: visibly more polished, harmonious and less cumbersome than the existing screenshot, while still feeling like the same product. A practical elegant Chinese learning application, quiet cool white background #f7f8fc, white surfaces, dark slate type, restrained violet #7155e8, soft 8–12px corners and delicate borders. NO gradients, NO huge decorative icons, NO marketing banners, NO numbered steps, NO gamification charts, NO enormous blank ocean, NO excessive nested panels. Use fine typography, consistent spacing, alignment and useful hierarchy. Legible Chinese at normal weight.

Composition, about 1440x900:
1. Slim 60px existing product header, left a small graduation-cap symbol and exact name “知识练习”, right understated links “知识图谱”, “帮助”, circular avatar. Retain a slim left navigation rail approx 180px, simple text+line-icon entries “开始练习” active in soft violet, “学习记录”, “我的收藏”, “学习报告”. At bottom of rail small “账号设置”. Remove the giant XP/statistics panel from top; do not replace it with a chart.
2. Main area starts at x≈220, width≈1180. A modest 26px heading “开始练习” and one soft-gray short subtitle “选好试卷，找到适合你的练习方式。” Optional “继续上次 →” quiet link at right, not a big card.
3. Compact PAPER LIBRARY (not the main attraction) near top, heading “试卷库” in 17px. On same line: small search “搜索试卷”, dropdown “全部科目”, understated “全部 / 免费 / 会员” filter, right “更多 ›”. Below exactly THREE compact paper cards in one row, height≈88px, selected first with a thin violet outline and very light tint. Titles “综合练习 01”, “知识巩固练习”, “情境应用练习”. ONE metadata line each “PMP · 100题 · 免费”, “PMP · 60题 · 会员”, “PMP · 50题 · 免费”. No progress bars, no big number graphics, no duplicate selected-paper summary panel.
4. Next, a small heading “选择练习模式”, with short gray context text “当前试卷：综合练习 01” aligned right. Under it FOUR SEPARATE equal-width MODE CARDS in ONE ROW, slightly more prominent than paper cards, approximately 265px wide and 225px tall, restrained shadows or none, white surface, soft border. Each has its own small distinctive line icon on a 36px tinted square, a clear 19px mode name, a small circled help ? at top-right, a one-line accurate purpose, compact relevant detail and an individual entry button aligned at the same bottom baseline. They must look like a cohesive family with distinct subtle icon colors (violet, blue, amber, muted rose); never flood the cards with color.
Card 1 icon document, “普通练习”, subtitle “按自己的节奏，稳步巩固”, a compact inline settings line “10题 ▾   试卷顺序 ▾” instead of the original huge common setup panel. Bottom one filled violet button “开始练习”. Its border can be gently violet because active.
Card 2 icon diamond or shield, “挑战模式”, subtitle “整卷闯关，检验掌握程度”, tiny gray detail “答错扣血 · 挑战整卷”. Bottom subtle pale blue or outline button “开始挑战”.
Card 3 icon lightning bolt, “学霸模式”, subtitle “限时作答，训练判断速度”, tiny gray detail “答对加时 · 连对回血”. Bottom subtle pale amber or outline button “进入学霸模式”.
Card 4 icon circular counterclockwise arrow, “复仇模式”, subtitle “重做错题，巩固薄弱知识点”, tiny rose detail “可复仇 12题” (illustrative). Bottom subtle pale rose or outline button “开始复仇”.
Do not change mode mechanics; ordinary settings belong in ordinary card. No second redundant start button outside cards.
5. Under modes, a very calm low-height panel with small text tabs “学习记录 / 我的收藏”, a right “查看更多 ›”, and only ONE compact recent-learning row “综合练习 01 · 普通练习” with “已答 8/20题” and small “继续” action. Not a full table or extra metrics. This uses remaining space without distracting from modes.

Keep the four modes absolutely dominant and recognizable, simplify the surrounding interface and duplicate information, not the modes themselves. Thoughtfully balanced, polished but restrained, believable application screenshot rather than a wireframe or administrative form. No design annotation, no watermark, no alternative screens.

## 第四版完整提示词

Use case: ui-mockup. Act as a senior product designer and UI designer. Generate ONE horizontal 16:10 desktop application screen for a Chinese learning product based on the supplied EXISTING APP screenshot. This is a considered product redesign, not mere removal of components. User demands a simpler, beautiful practice lobby while keeping the original FOUR PRACTICE MODES, each with its own name and entry. Product reasoning: ordinary practice is the natural default daily action; Challenge and Scholar are distinct advanced paths; Revenge is a contextual revision path driven by existing wrong answers. Preserve access to paper selection, mode rules, history, favorites, reports, account, ordinary count and order. Do not invent a generic dashboard or a marketing page.

High craft, calm Chinese SaaS aesthetic: pale cool-gray page #f7f8fc, white surfaces, deep slate text, restrained purple #7155e8 brand. Crisp regular-weight Chinese sans-serif, small clear line icons. Hairline borders, 10px consistent corners, restrained single soft shadow only if needed, 24–28px content gaps. NO gradients, NO giant icons, NO decorative art, NO large stats, NO numbered steps, NO oversized page banners, NO KPI cards, NO full-width tables. Use composition and typography, not decoration. One screen, no annotations, no device/browser frame, no watermark.

1440x900-like screen:
Top existing 56px app header: small graduation-cap glyph + “知识练习” left. Right quiet “知识图谱”, a help icon, and account avatar.
Left compact 164px navigation sidebar, white, fine border, top starts with “开始练习” active soft lavender, below “学习记录”“我的收藏”“学习报告”; bottom “账号设置”. No XP chart.
Main content centered in remaining area, max-width about 1140px with 36px gutters. Top a 26px “开始练习”, right small text link “继续上次 →”. No subtitle.

Paper-selection section is light, compact supporting content. Heading “试卷库” 16px with search field “搜索试卷”, subject dropdown “全部科目”, unboxed “全部 / 免费 / 会员”, right “更多 ›” all on one lean line. Under it EXACTLY THREE compact equal paper tiles, 72–84px high, no giant enclosing section panel: “综合练习 01” / “知识巩固练习” / “情境应用练习”, each with one metadata line “PMP · 100题 · 免费” / “PMP · 60题 · 会员” / “PMP · 50题 · 免费”. First has a 1px violet outline, tiny check or radio, very pale tint. NO paper progress bars.

Now the core MODE AREA: a deliberate ASYMMETRIC 4-card composition that preserves all four recognizable modes and their individual buttons. Small section heading “选择练习模式”, gray context “当前试卷：综合练习 01”.
- LEFT 40% width: ONE tall calm ordinary-practice card spanning full height of the mode composition (~300px). White surface, fine lavender border, small 32px document icon, tiny gray eyebrow “日常巩固”, exact heading “普通练习” 23px. One concise description “按自己的节奏，逐步掌握知识。” Below compact controls “题量  10题 ▾” and “顺序  试卷顺序 ▾”, not bulky toggle arrays. At bottom one well-proportioned filled violet button “开始练习”, tiny ? rules button at top-right. This is the primary entry, but NOT a giant purple background.
- RIGHT 60% width, TOP ROW: TWO separate equal cards about 170px tall. First “挑战模式” with a small blue diamond icon, description “整卷闯关，检验掌握程度”, tiny note “答错扣血”, independent understated outline entry “开始挑战 →”, ? at top-right. Second “学霸模式” with a small amber lightning icon, description “限时作答，训练判断速度”, tiny note “答对加时 · 连对回血”, independent understated outline entry “进入学霸模式 →”, ? at top-right. Both white surfaces, keep text hierarchy crisp and readable.
- RIGHT 60% width, BOTTOM ROW: ONE separate compact horizontal Revenge card about 105–115px tall. Small muted-rose counterclockwise arrow icon at left, exact heading “复仇模式”, description “重做错题，巩固薄弱知识点”, small status “12道错题待复习” underneath or beside. On the right its OWN small subtle pale-rose entry button “开始复仇”, with tiny ? rules help nearby. This must visibly read as the fourth INDEPENDENT MODE, not an alert banner or footnote. Subtle pale rose icon/label only, do not flood background with pink. The ordinary card's bottom aligns with the revenge card's bottom.
All four names and entries must be immediately readable. Do not collapse modes into tabs, segmented controls, a dropdown or a single generic start button. The different card dimensions express product priority, with a cohesive visual system.

Below mode composition, one quiet compact “最近学习” strip: one recent paper entry “综合练习 01 · 普通练习” with gray “已答 8/20题”, and small right-aligned “继续 →”. History/favorites full access stays in sidebar. No large outer panel, no duplicate selected paper summary, no motivational chart. Lower screen whitespace modest and balanced, not a huge vacant ocean.

The design should feel thoughtfully composed, elegant, useful, recognizable as the original app evolved. The study modes are the core, paper/configuration are supporting, four modes retained without equal visual competition. Illustrative records only. Render readable exact Chinese labels; no random English micro-headlines.

