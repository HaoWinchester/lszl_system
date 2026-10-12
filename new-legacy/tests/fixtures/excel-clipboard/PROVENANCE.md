# Native Excel clipboard fixture

2026-10-12, Microsoft Excel for Mac 16.90.2. Workbook is a wholly synthetic local openpyxl file, no user business data. Opened locally in Excel (read-only activation mode), selected 粘贴验收!A1:D5 through Name Box, confirmed full five-row/four-column selection visually and pressed Cmd+C. Native Chrome Cmd+V into a loopback-only test page captured the actual paste event clipboardData. Raw JSON retained as native-clipboard.json; portable-clipboard.json replaces only machine-local Excel cache file URI. No content, linebreaks, table structure, spans or markup formatting otherwise changed. Server stopped and test tab/workbook closed. No sign-in/activation/add-in installation needed or attempted.

Data: Chinese, English, number123, identifier00123, literal quotes, embedded newline/tab, empty trailing cells, a2x2 merge at A3:B4, literal formula-like text that is not an Excel formula. Actual MIME types text/plain,text/html,text/rtf,Files; parser should prioritize HTML and ignore pasted file objects when table markup exists. TSV has CRLF rows, LF inside quoted cell, quoted tab, and no final newline; trailing tab represents final empty column. HTML contains colspan=2,rowspan=2.

expected.json is the source-cell matrix and merged range. HTML may display literal tab differently from TSV; test according to captured display-text semantics rather than assuming invisible character roundtrip. This capture verifies one macOS Excel version only; no Windows Excel claim.

Workbook SHA256: cc3d095a83131b213f6344732dc183c916802edc41829e0a949b9c85b7f5ba16
Raw clipboard SHA256: 8762d485725b770bacb56b249cdc6a6fd37a65e0997a7a2f848c73fa72d20afd
