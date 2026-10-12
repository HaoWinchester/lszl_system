# XML-only synthetic native-open verification

Date: 2026-10-12. App: XMind 24.04.10311 (2024052619230), macOS.
Source: repository-generated XML-only synthetic fixture, NOT a file exported by an old XMind version.

Opened via XMind native File > Open. Confirmed first sheet XML 中文工作表 with root XML 根主题 English, child 二级主题 and grandchild 三级主题; second sheet 第二 XML 表 contains 第二根主题. Root has rounded yellow fill, bold text and dashed dark border/links. Opened root Notes and saw the exact two lines `XML 中文备注` and `完整保留。`.

Initial fixture used xlink:href on xhtml:img; XMind opened but did not display the image. Worker corrected to xhtml:src. Closed and reopened updated archive, visually confirmed embedded PNG above root title. Screenshot xml-only-first-corrected.png records corrected rendering. Initial xml-only-first.png records the failed-image baseline; xml-only-notes.png records notes. No file save or app conversion was performed; original fixture bytes remain unchanged by desktop app.

Limit: validates this synthetic XML package against current desktop reader, not an old desktop writer/version claim. Exact font-size not independently measured in UI.

Final archive SHA256: 95ea36d4dcf2b62b66172f6d2049e36aec89ef458347876b99520274b2c50b05
