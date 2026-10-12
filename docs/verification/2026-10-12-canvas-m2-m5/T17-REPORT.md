# T17 — implementation report (2026-10-12)

## Implemented

- `new-legacy/src/canvas/table-model.js`（global.KGCanvasTableModel）：TableV1 {id,schemaVersion:1,x,y,rows,cols,columnWidths,rowHeights,cells(稀疏 'r,c'→text),merges(0-based 矩形)}；LIMITS 100行/50列/每表5000格/画布20000格/每格3000字符/默认3×3；normalize（白名单字段、非法抛中文错误）、merge（矩形、部分重叠拒绝"先拆分"、整体包含并入、内容行优先跳空换行拼左上、合并超3000拒绝）、split（移除 merge，左上内容保留）、paste（扩行列、与现有 merge 相交拒绝、超限整体拒绝、单格超3000拒绝不截断、剪贴板 merges 映射进入）。所有修改返回新对象，原表不变。
- `new-legacy/src/canvas/table-clipboard.js`（global.KGCanvasTableClipboard）：Excel HTML 优先（rowspan/colspan、br 换行、script/style 忽略、U+3000/NBSP 视为空格），否则 TSV（quoted 字段、"" 转义、引号内 tab/换行、CRLF、尾随空行、行尾空列）；无 DOMParser 环境安全降级；不执行脚本/公式。
- 跟踪样本：native Excel 16.90.2 剪贴板 portable-clipboard.json + expected.json + PROVENANCE → new-legacy/tests/fixtures/excel-clipboard/。
- `backend/app/schemas/canvas_table.py`：CanvasTable/TableMerge（extra forbid）同语义校验 + validate_tables 画布级 20000。
- wrapper `frontend/scripts/canvas-table.test.mjs` 登记 2 个 Node 测试（进 pnpm test）。

## Tests

- Node：canvas-table-model.test.js 4 + canvas-table-clipboard.test.js 3 = 7 passed（TSV 输出与真实 Excel 样本逐格一致）。
- Python：test_canvas_table.py 4 passed。
- HTML rowspan/colspan 解析需 DOM，Node 不覆盖，由 T19 浏览器测试用真实 Excel HTML 样本覆盖（记入 T19 待办）。

## Commit

- 3d67c65e feat(canvas): model editable tables and spreadsheet paste（10 文件，纯模型层，无 UI/持久化接线——T18/T19 范围）

## Independent review & fixes

- 首轮审查：Critical C1（parseHTML colspan 锚格错位——优先 HTML 分支对 native 样本解析错误，内容被吞进合并区）+ Major M1（HTML 零覆盖）+ M2（JS/Python 三处毒数据通道：\Z/UTF-16 口径/isfinite）+ Minor M3-M6。
- 修复 commit 165598d0：锚格按逻辑列补位；新增 canvas-table-clipboard-browser.py（真实 DOM 与 native 样本逐格全等+XSS 探针）；Python \Z/utf16_length/isfinite；merge 子区域拒绝；paste 不规则 grid 拒绝；reduce 替代 spread（M6 一并关闭）。
- 复审：通过（约 20 个对抗探针实测）。残留：浏览器测试为手动运行（与项目其他浏览器测试惯例一致，T20 统一执行）；validate_tables 零调用方待 T18 接线；utf16_length 孤代理对报错文案偏技术（Info）。
- 最终：Node 7 passed / Python 4 passed / 浏览器 HTML PASS。
