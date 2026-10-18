# 大厅第六版提示词

用户要求：把科目去掉。修改范围为大厅科目筛选、试卷卡片科目标签；保留其余设计及后端数据。内置 image_gen 编辑第五版，生成 practice-lobby-v6.png，旧图保留。

Edit this Chinese desktop practice-lobby UI image with ONE targeted change: remove subject/course information everywhere in the paper-library area.

1. Completely remove the “全部科目” dropdown, including its border, chevron and occupied slot. Reflow the remaining library-toolbar items naturally: “试卷库”, the “搜索试卷” search field, the existing “全部 / 免费 / 会员” filters, and right-aligned “更多”. You may widen the search field slightly to balance the space; do not leave a visible gap where the subject dropdown was.
2. Remove the exact “PMP” text and the separator dot immediately after it from ALL THREE paper cards. Their metadata should now be only “100题 · 免费”, “60题 · 会员”, and “50题 · 免费”, retaining the existing free/member badges.
3. Do not add another category, subject label, course selector or replacement control.

Preserve every other element, layout, palette, font, sidebar, header, three paper cards and selection state. Preserve all FOUR independent practice-mode cards with their own titles, descriptions, help icons and start buttons: 普通练习, 挑战模式, 学霸模式, 复仇模式. Preserve ordinary count/order settings and top-right 继续上次. Do not add 最近学习 or a footer panel. Keep the same horizontal 16:10 dimensions and full-screen framing. Make no other design changes.

