"""真实 DOM 下的 HTML 表格剪贴板解析：与 native Excel 样本逐格全等。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
def main():
    fixture=json.loads((ROOT/'new-legacy/tests/fixtures/excel-clipboard/portable-clipboard.json').read_text())
    expected=json.loads((ROOT/'new-legacy/tests/fixtures/excel-clipboard/expected.json').read_text())
    source=(ROOT/'new-legacy/src/canvas/table-clipboard.js').read_text()
    model=(ROOT/'new-legacy/src/canvas/table-model.js').read_text()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        page=browser.new_page()
        page.goto('about:blank')
        page.evaluate(source);page.evaluate(model)
        grid=page.evaluate('(html)=>KGCanvasTableClipboard.parseHTML(html)',fixture['html'])
        assert grid, 'parseHTML returned null'
        # 与 native Excel 期望逐格全等（含 rowspan/colspan 合并区、<br> 换行、空尾列）。
        # expected.json 保留原生类型（数字/null），表格契约统一为字符串与空串。
        normalized=[[('' if v is None else str(v)) for v in row] for row in expected['cells']]
        assert grid['cells']==normalized,(grid['cells'],normalized)
        assert grid['merges']==expected['merges'],(grid['merges'],expected['merges'])
        # colspan 锚格行不错位：<td colspan=2>A</td><td>B</td> → 占位格留在合并区内，B 在列 2。
        probe=page.evaluate("KGCanvasTableClipboard.parseHTML('<table><tr><td colspan=\"2\">A</td><td>B</td></tr></table>')")
        assert probe['cells']==[['A','','B']],probe['cells']
        assert probe['merges']==[{'row':0,'column':0,'rowSpan':1,'columnSpan':2}]
        # 端到端：HTML 样本粘贴进空表，合并区外内容不被吞。
        table=page.evaluate('''(grid)=>{
          const t=KGCanvasTableModel.create({id:'tb_x',rows:grid.cells.length,cols:grid.cells[0].length});
          return JSON.parse(JSON.stringify(KGCanvasTableModel.paste(t,{row:0,column:0},grid)));
        }''',grid)
        merged=next(m for m in table['merges'] if m['rowSpan']>1)
        anchor=table['cells'].get(f"{merged['row']},{merged['column']}")
        assert anchor and '合并区域' in anchor,table['cells']
        col=merged['column']+merged['columnSpan']
        assert table['cells'].get(f"{merged['row']},{col}")=='首尾空格 ',table['cells']
        # 剪贴板脚本不执行：script 内容不进入单元格。
        xss=page.evaluate("KGCanvasTableClipboard.parseHTML('<table><tr><td><script>window.__pwned=1</script>safe</td></tr></table>')")
        assert xss['cells']==[['safe']],xss['cells']
        assert page.evaluate('window.__pwned') is None
        browser.close();print('PASS: parseHTML matches native Excel sample; colspan anchor fixed; scripts not executed')
if __name__=='__main__':main()
