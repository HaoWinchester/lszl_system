"""T19 浏览器测试：三页共享可编辑表格（R16/AC16）。

覆盖：插入网格 3×3、中英文输入、整体拖动、四边缩放、列宽调整、合并两格（内容换行拼接）、
Excel HTML 样本粘贴（起始格 + 空画布新建）、编辑态 Delete 不删表、单次撤销恢复合并、
三页分别保存重开保留、只读禁写。
运行：先启动 new-legacy/tests/helpers/graph_template_server.py（端口 5195），再
  python3 new-legacy/tests/canvas-table-browser.py --base-url http://127.0.0.1:5195
"""
import argparse,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
CELL='.kg-canvas-table-cell'

def dismiss_overlays(page):
    page.wait_for_timeout(500)
    for selector in ('#learningEntryDismissBtn','.tour-skip','#hideHelpBtn'):
        loc=page.locator(selector)
        if loc.count() and loc.first.is_visible():
            try: loc.first.click()
            except Exception: pass
            page.wait_for_timeout(150)

def insert_table(page,rows,cols,trigger):
    page.locator(trigger).click()
    page.locator('.kg-canvas-table-insert-panel').wait_for(state='visible')
    page.locator(f'.kg-canvas-table-insert-grid button[data-grid-row="{rows}"][data-grid-col="{cols}"]').click()
    page.locator('.kg-canvas-table-wrap').first.wait_for(state='visible')

def cell_text(page,row,col):
    selector=f'{CELL}[data-row="{row}"][data-column="{col}"]'
    return page.evaluate("sel=>document.querySelector(sel)?.textContent||''",selector)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);args=parser.parse_args()
    base=args.base_url.rstrip('/')
    assert base.startswith('http://127.0.0.1:')
    out=ROOT/'artifacts/canvas-m2-m5/t19';out.mkdir(parents=True,exist_ok=True)
    fixture=json.loads((ROOT/'artifacts/canvas-m2-m5/t15/fixture.json').read_text())
    users=fixture['users'];password=fixture['password']
    excel=json.loads((ROOT/'new-legacy/tests/fixtures/excel-clipboard/portable-clipboard.json').read_text())
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        # —— 服务端准备（独立 API 会话）：图谱测试文件 + 深度回忆试卷发布 ——
        setup=proxy=browser.new_context(viewport={'width':1440,'height':900})
        assert setup.request.post(base+'/api/v1/auth/login',data={'username':users['teacher'],'password':password}).ok
        file=setup.request.post(base+'/api/v1/files',data={'name':'T19 表格验证','graphData':{'nodes':[{'id':'n1','title':'复制源卡','x':700,'y':420,'content':{'title':'复制源卡'}}],'links':[]}}).json()['file']
        file2=setup.request.post(base+'/api/v1/files',data={'name':'T19 空画布粘贴','graphData':{'nodes':[],'links':[]}}).json()['file']
        # 深度回忆：other 老师建卷（公开题库里的题）→ 发布 deep_recall 免费卷给 student。
        assert setup.request.post(base+'/api/v1/auth/login',data={'username':users['other'],'password':password}).ok
        # 通用学科免 PMP 考试领域预检。
        paper=setup.request.post(base+'/api/v1/papers',data={'name':'T19 深度回忆卷','subject':'通用学习'}).json()['paper']
        revision=setup.request.get(base+'/api/v1/papers/'+paper['id']).json()['paper']['revision']
        assert setup.request.put(base+'/api/v1/papers/'+paper['id']+'/questions',
            data={'revision':revision,'questions':[{'bankId':users['public_bank'],'questionId':users['public'],'order':1}]}).ok
        revision=setup.request.get(base+'/api/v1/papers/'+paper['id']).json()['paper']['revision']
        published=setup.request.post(base+f"/api/v1/paper-releases/papers/{paper['id']}/publish",
            data={'revision':revision,'accessLevel':'free','enabledModes':['practice_mode','deep_recall'],'allowedRoles':['student']}).json()['release']
        assert published['enabledModes'],'发布失败'
        assert setup.request.post(base+'/api/v1/auth/logout').ok

        ctx=browser.new_context(viewport={'width':1440,'height':900})
        assert ctx.request.post(base+'/api/v1/auth/login',data={'username':users['teacher'],'password':password}).ok
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':file['id']}).ok

        # —— 图谱页：插入 / 编辑 / 拖动 / 缩放 / 列宽 / 合并 / 粘贴 / 撤销 / 保存重开 ——
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append('graph pageerror: '+str(e)))
        page.goto(base+'/index.html',wait_until='networkidle')
        page.wait_for_function('!KGGraphFileTabs.isSwitching()')
        dismiss_overlays(page)
        insert_table(page,3,3,'#addTableBtn')
        assert page.evaluate('KGHomeTables.tables.length===1 && KGHomeTables.tables[0].rows===3 && KGHomeTables.tables[0].cols===3')
        cells=page.locator(CELL)
        cells.nth(0).click();page.keyboard.type('重点整理')
        cells.nth(1).click();page.keyboard.type('risk note')
        page.wait_for_timeout(250)
        assert cell_text(page,0,0)=='重点整理' and cell_text(page,0,1)=='risk note',(cell_text(page,0,0),cell_text(page,0,1))
        # 编辑态删除键只删字符，不删整表（R16-4；光标在末尾用退格删 'e','t'）
        page.keyboard.press('Backspace');page.keyboard.press('Backspace')
        page.keyboard.press('Backspace');page.keyboard.press('Backspace')
        page.wait_for_timeout(200)
        assert page.evaluate('KGHomeTables.tables.length===1')
        assert cell_text(page,0,1).strip()=='risk',repr(cell_text(page,0,1))
        page.keyboard.press('Escape')
        # 整体拖动（movebar）
        before=page.evaluate('JSON.stringify(KGHomeTables.tables[0])');before=json.loads(before)
        bar=page.locator('.kg-canvas-table-movebar').first;box=bar.bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        page.mouse.down();page.mouse.move(box['x']+box['width']/2+90,box['y']+box['height']/2+60,steps=8);page.mouse.up()
        page.wait_for_timeout(250)
        after=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert abs(after['x']-before['x']-90)<3 and abs(after['y']-before['y']-60)<3,(before,after)
        # 四边缩放（东边等比放大列宽）
        widths_before=after['columnWidths']
        handle=page.locator('.kg-canvas-table-resize-e').first;hb=handle.bounding_box()
        page.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2)
        page.mouse.down();page.mouse.move(hb['x']+hb['width']/2+120,hb['y']+hb['height']/2,steps=6);page.mouse.up()
        page.wait_for_timeout(250)
        widths_after=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0].columnWidths)'))
        assert sum(widths_after)>sum(widths_before)+90,(widths_before,widths_after)
        ratio=widths_after[0]/widths_before[0]
        for index,value in enumerate(widths_after):
            assert abs(value-widths_before[index]*ratio)<2,f'列宽未等比缩放: {widths_after}'
        # 列边界拖拽（第 0/1 列边界右移 → 第 1 列变宽）
        boundary=page.locator('.kg-canvas-table-boundary-col').first;bb=boundary.bounding_box()
        page.mouse.move(bb['x']+bb['width']/2,bb['y']+20)
        page.mouse.down();page.mouse.move(bb['x']+bb['width']/2+50,bb['y']+20,steps=5);page.mouse.up()
        page.wait_for_timeout(250)
        col_after=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0].columnWidths)'))
        assert col_after[1]-widths_after[1]>=40,(widths_after,col_after)
        page.screenshot(path=str(out/'graph-table-edited.png'))
        # 合并两格：内容换行拼接进左上格（单次历史操作）
        page.locator(f'{CELL}[data-row="1"][data-column="0"]').click();page.keyboard.type('甲');page.keyboard.press('Escape')
        page.locator(f'{CELL}[data-row="1"][data-column="1"]').click();page.keyboard.type('乙');page.keyboard.press('Escape')
        page.locator(f'{CELL}[data-row="1"][data-column="0"]').click()
        page.keyboard.down('Shift');page.locator(f'{CELL}[data-row="1"][data-column="1"]').click();page.keyboard.up('Shift')
        page.locator('[data-table-action="merge"]').click()
        page.wait_for_timeout(300)
        merged=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert merged['merges']==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}],merged['merges']
        assert merged['cells'].get('1,0')=='甲\n乙',merged['cells']
        assert page.locator(f'{CELL}[rowspan],{CELL}[colspan]').count()>=1
        # Excel 样本 HTML 粘贴到选中起始格（(2,0) 与合并区不相交；结构文本与 native 样本逐格全等）
        expected=json.loads((ROOT/'new-legacy/tests/fixtures/excel-clipboard/expected.json').read_text())
        page.locator(f'{CELL}[data-row="2"][data-column="0"]').click()
        page.evaluate('''html=>{
          const dt=new DataTransfer();
          dt.setData('text/html',html);
          dt.setData('text/plain','x\\ty\\n');
          document.querySelector('.kg-canvas-table-cell[data-row="2"][data-column="0"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
        }''',excel['html'])
        page.wait_for_timeout(300)
        pasted=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        grid_rows=len(expected['cells']);grid_cols=len(expected['cells'][0])
        assert pasted['rows']>=2+grid_rows and pasted['cols']>=grid_cols,(pasted['rows'],pasted['cols'])
        for r,row in enumerate(expected['cells']):
            for c,value in enumerate(row):
                text='' if value is None else str(value)
                assert pasted['cells'].get(f'{2+r},{c}','')==text,(f'{2+r},{c}',text,pasted['cells'].get(f'{2+r},{c}'))
        assert any(m['row']==2+2 and m['rowSpan']==2 for m in pasted['merges']),'Excel 合并区未保留（A3:B4 → 行4）'
        page.screenshot(path=str(out/'graph-table-pasted.png'))
        # 单次撤销：先撤粘贴（回 3×3+合并），再撤合并（内容回两格）；重做恢复合并
        page.keyboard.press('Meta+z');page.wait_for_timeout(250)
        step1=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert step1['rows']<5 and step1['merges']==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}],step1
        page.keyboard.press('Meta+z');page.wait_for_timeout(250)
        step2=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert step2['merges']==[] and step2['cells'].get('1,0')=='甲' and step2['cells'].get('1,1')=='乙',step2
        page.keyboard.press('Meta+Shift+z');page.wait_for_timeout(250)
        assert json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0].merges)'))==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}]
        # 保存重开：等 autosave 落库后刷新
        page.wait_for_timeout(1500)
        remote=ctx.request.get(base+'/api/v1/files/'+file['id']).json()
        assert len(remote['graphData']['tables'])==1,'服务端未收到表格'
        page.reload(wait_until='networkidle')
        page.wait_for_function('!KGGraphFileTabs.isSwitching()');dismiss_overlays(page)
        page.wait_for_function('KGHomeTables.tables.length===1')
        reopened=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert reopened['merges']==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}],reopened['merges']
        assert reopened['cells'].get('0,0')=='重点整理' and reopened['cells'].get('0,1','').startswith('risk')
        assert reopened['columnWidths']==col_after and reopened['x']==after['x']

        # —— 审查修复回归：多表隔离（C1）/ 拖动撤销回拖前（M1）/ 卡牌粘贴不被劫持（M3） ——
        insert_table(page,2,2,'#addTableBtn')
        assert page.evaluate('KGHomeTables.tables.length===2')
        pair=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables)'))
        tableA,tableB=pair[0],pair[1]
        wrapA=f'.kg-canvas-table-wrap[data-table-id="{tableA["id"]}"]'
        wrapB=f'.kg-canvas-table-wrap[data-table-id="{tableB["id"]}"]'
        # 拖动表 B（后插入者在顶层）：A 位置保持不动
        bar=page.locator(f'{wrapB} .kg-canvas-table-movebar');box=bar.bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        page.mouse.down();page.mouse.move(box['x']+box['width']/2+260,box['y']+box['height']/2+160,steps=8);page.mouse.up()
        page.wait_for_timeout(300)
        pair=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables)'))
        assert abs(pair[1]['x']-tableB['x']-260)<3 and abs(pair[1]['y']-tableB['y']-160)<3,pair[1]
        assert pair[0]['id']==tableA['id'] and abs(pair[0]['x']-tableA['x'])<1 and abs(pair[0]['y']-tableA['y'])<1,'拖动 B 影响了 A'
        # 撤销拖动：B 回到拖前位置，A 仍在（快照含兄弟表）
        page.keyboard.press('Meta+z');page.wait_for_timeout(300)
        pair=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables)'))
        assert abs(pair[1]['x']-tableB['x'])<1 and abs(pair[1]['y']-tableB['y'])<1,f'拖动撤销未回拖前: {pair[1]}'
        assert len(pair)==2 and pair[0]['id']==tableA['id'] and abs(pair[0]['x']-tableA['x'])<1,'撤销拖动丢失兄弟表'
        # 表格选中状态下复制卡牌→Ctrl/⌘+V 仍走卡牌粘贴（M3：非表格状剪贴板放行页面语义；B 在顶层可点）
        page.locator('.knowledge-card[data-node-id="n1"]').click()
        page.keyboard.press('Meta+c')
        page.wait_for_function('KGGraphKernel.clipboard.hasData()')
        page.locator(f'{wrapB} {CELL}[data-row="0"][data-column="0"]').click()  # 选中表格 B
        page.keyboard.press('Escape')  # 退出编辑态，保持表格选择
        node_before=page.evaluate('state.nodes.length')
        page.keyboard.press('Meta+v')
        page.wait_for_timeout(800)
        assert page.evaluate('state.nodes.length')>node_before,'卡牌粘贴被表格劫持'
        assert cell_text(page,0,0)=='重点整理','图谱片段文本被写进单元格'
        # 在 B 上合并：A 的内容/合并不受影响（单表操作只替换目标表；B 在顶层可点）
        page.locator(f'{wrapB} {CELL}[data-row="0"][data-column="0"]').click()
        page.keyboard.down('Shift');page.locator(f'{wrapB} {CELL}[data-row="0"][data-column="1"]').click();page.keyboard.up('Shift')
        page.locator(f'{wrapB} [data-table-action="merge"]').click()
        page.wait_for_timeout(300)
        pair=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables)'))
        assert len(pair)==2 and pair[0]['cells'].get('0,0')=='重点整理' and pair[0]['cells'].get('1,0')=='甲\n乙',pair[0]
        assert pair[0]['merges']==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}]
        assert pair[1]['merges']==[{'row':0,'column':0,'rowSpan':1,'columnSpan':2}],pair[1]
        # 撤销 B 合并：B 恢复，A 合并保留
        page.keyboard.press('Meta+z');page.wait_for_timeout(300)
        pair=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables)'))
        assert len(pair)==2 and pair[0]['merges']==[{'row':1,'column':0,'rowSpan':1,'columnSpan':2}] and pair[1]['merges']==[],pair
        page.screenshot(path=str(out/'graph-two-tables.png'))
        page.close()

        # —— 空画布粘贴建新表；普通句子不建表 ——
        assert ctx.request.put(base+'/api/v1/files/current',data={'fileId':file2['id']}).ok
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append('graph2 pageerror: '+str(e)))
        page.goto(base+'/index.html',wait_until='networkidle')
        page.wait_for_function('!KGGraphFileTabs.isSwitching() && KGHomeTables.tables.length===0');dismiss_overlays(page)
        page.evaluate('''html=>{
          const dt=new DataTransfer();
          dt.setData('text/html',html);
          document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
        }''',excel['html'])
        page.wait_for_function('KGHomeTables.tables.length===1')
        created=json.loads(page.evaluate('JSON.stringify(KGHomeTables.tables[0])'))
        assert created['rows']==5 and created['cols']==4,created
        # 粘贴建表必须携带单元格内容与合并区（回归：曾只建结构丢内容）
        assert created['cells'].get('0,0')=='中文' and created['cells'].get('2,2')=='00123',created['cells']
        assert created['merges'] and created['merges'][0]['rowSpan']==2,created['merges']
        assert page.locator('.kg-canvas-table-wrap').count()==1
        page.evaluate('''()=>{
          const dt=new DataTransfer();dt.setData('text/plain','just a sentence');
          document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
        }''')
        page.wait_for_timeout(250)
        assert page.evaluate('KGHomeTables.tables.length===1'),'普通文本误建表'
        page.screenshot(path=str(out/'graph-empty-paste.png'))
        page.close()

        # —— 多题归纳页：插入 / 编辑 / 合并 / kernel 单次撤销 / 保存重开 ——
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append('qw pageerror: '+str(e)))
        page.goto(base+'/question-workspace.html',wait_until='networkidle')
        page.wait_for_function('!!window.KGWorkspaceTables');page.wait_for_timeout(800)
        dismiss_overlays(page)
        # 空画布引导层会拦截表格区域的指针，测试中移除（正常用户可拖入题目后消失）。
        page.evaluate("document.getElementById('qwEmptyState')?.remove()")
        # 新建干净画布，避免上一轮遗留表格干扰。
        page.evaluate("window.prompt=()=>'T19 表格画布'")
        page.evaluate("KGMultiQuestionWorkspace.createWorkspace()")
        page.wait_for_function("KGMultiQuestionWorkspace.activeWorkspace()?.title==='T19 表格画布'")
        page.wait_for_timeout(400)
        page.evaluate("document.getElementById('qwEmptyState')?.remove()")
        insert_table(page,2,3,'#qwTableBtn')
        cells=page.locator(CELL)
        cells.nth(0).click();page.keyboard.type('错题一')
        cells.nth(1).click();page.keyboard.type('timing')
        page.wait_for_timeout(300)
        qw=json.loads(page.evaluate('JSON.stringify(KGMultiQuestionWorkspace.activeWorkspace())'))
        assert qw['tables'] and qw['tables'][0]['cells'].get('0,0')=='错题一' and qw['tables'][0]['cells'].get('0,1')=='timing',qw.get('tables')
        page.locator(f'{CELL}[data-row="0"][data-column="0"]').click()
        page.keyboard.down('Shift');page.locator(f'{CELL}[data-row="0"][data-column="1"]').click();page.keyboard.up('Shift')
        page.locator('[data-table-action="merge"]').click();page.wait_for_timeout(300)
        assert page.evaluate('KGMultiQuestionWorkspace.activeWorkspace().tables[0].merges.length===1')
        assert page.locator(f'{CELL}[colspan]').count()==1,'合并后 DOM 未呈现 colspan'
        # 撤销：模型与 DOM（rowspan/colspan 消失）都要还原（M2）
        page.keyboard.press('Meta+z')
        page.wait_for_function('KGMultiQuestionWorkspace.activeWorkspace().tables[0].merges.length===0')
        page.wait_for_function('document.querySelectorAll(".kg-canvas-table-cell[rowspan],.kg-canvas-table-cell[colspan]").length===0',timeout=5000)  # 撤销后表格层重绘（M2）
        page.keyboard.press('Meta+Shift+z')
        page.wait_for_function('KGMultiQuestionWorkspace.activeWorkspace().tables[0].merges.length===1')
        page.wait_for_function('document.querySelectorAll(".kg-canvas-table-cell[colspan]").length===1',timeout=5000)  # 重做后表格层重绘
        page.wait_for_timeout(2000)  # 等待 store 服务端保存
        page.reload(wait_until='networkidle')
        page.wait_for_function('!!window.KGWorkspaceTables');page.wait_for_timeout(800);dismiss_overlays(page)
        page.wait_for_function('(()=>{const w=window.KGMultiQuestionWorkspace?.activeWorkspace?.();return w&&w.tables&&w.tables.length===1})()')
        qw_reopened=json.loads(page.evaluate('JSON.stringify(KGMultiQuestionWorkspace.activeWorkspace().tables[0])'))
        assert qw_reopened['merges']==[{'row':0,'column':0,'rowSpan':1,'columnSpan':2}],qw_reopened
        assert (qw_reopened['cells'].get('0,0') or '').startswith('错题一')
        page.screenshot(path=str(out/'qw-table.png'))
        page.close()

        # —— 深度回忆页（member 学员正式会话）：插入 / 编辑 / 面板撤销重做 / 保存重开 / 只读禁写 ——
        member_ctx=browser.new_context(viewport={'width':1440,'height':900})
        assert member_ctx.request.post(base+'/api/v1/auth/login',data={'username':users['member'],'password':password}).ok
        page=member_ctx.new_page();page.on('pageerror',lambda e:errors.append('kr pageerror: '+str(e)))
        page.goto(base+f"/knowledge-recall.html?questionId={users['public']}",wait_until='networkidle')
        page.wait_for_function('!!window.KGRecallTables',timeout=20000)
        page.wait_for_timeout(1500);dismiss_overlays(page)
        assert page.evaluate('!document.body.classList.contains("kr-readonly")'),'深度回忆会话应为可写'
        insert_table(page,2,2,'#krTableBtn')
        cells=page.locator(CELL)
        cells.nth(0).click();page.keyboard.type('回忆线索')
        page.wait_for_timeout(500)
        assert page.evaluate('KGRecallTables.tables.length===1 && KGRecallTables.tables[0].cells["0,0"]==="回忆线索"')
        page.locator(f'{CELL}[data-row="0"][data-column="0"]').click()
        page.keyboard.down('Shift');page.locator(f'{CELL}[data-row="0"][data-column="1"]').click();page.keyboard.up('Shift')
        page.locator('[data-table-action="merge"]').click();page.wait_for_timeout(300)
        assert page.evaluate('KGRecallTables.tables[0].merges.length===1')
        page.locator('[data-table-action="undo"]').first.click();page.wait_for_timeout(300)
        assert page.evaluate('KGRecallTables.tables[0].merges.length===0'),'面板撤销未生效'
        page.locator('[data-table-action="redo"]').first.click();page.wait_for_timeout(300)
        assert page.evaluate('KGRecallTables.tables[0].merges.length===1'),'面板重做未生效'
        page.wait_for_timeout(2000)  # 等 saveProgress 防抖落库
        page.reload(wait_until='networkidle')
        page.wait_for_function('!!window.KGRecallTables',timeout=20000)
        page.wait_for_timeout(1500);dismiss_overlays(page)
        page.wait_for_function('KGRecallTables.tables.length===1',timeout=15000)
        kr_reopened=json.loads(page.evaluate('JSON.stringify(KGRecallTables.tables[0])'))
        assert kr_reopened['merges']==[{'row':0,'column':0,'rowSpan':1,'columnSpan':2}],kr_reopened
        assert kr_reopened['cells'].get('0,0')=='回忆线索'
        # 拖动后撤销回到拖前位置（M1：内部命令栈用拖前快照）
        pre=json.loads(page.evaluate('JSON.stringify({x:KGRecallTables.tables[0].x,y:KGRecallTables.tables[0].y})'))
        bar=page.locator('.kg-canvas-table-movebar').first;box=bar.bounding_box()
        page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        page.mouse.down();page.mouse.move(box['x']+box['width']/2+50,box['y']+box['height']/2+40,steps=6);page.mouse.up()
        page.wait_for_timeout(300)
        moved=json.loads(page.evaluate('JSON.stringify({x:KGRecallTables.tables[0].x,y:KGRecallTables.tables[0].y})'))
        assert abs(moved['x']-pre['x']-50)<3 and abs(moved['y']-pre['y']-40)<3,(pre,moved)
        page.locator('[data-table-action="undo"]').first.click()
        page.wait_for_timeout(300)
        restored=json.loads(page.evaluate('JSON.stringify({x:KGRecallTables.tables[0].x,y:KGRecallTables.tables[0].y})'))
        assert abs(restored['x']-pre['x'])<1 and abs(restored['y']-pre['y'])<1,f'拖动撤销未回拖前: {pre}→{restored}'
        page.screenshot(path=str(out/'kr-table.png'))
        # 只读态（kr-readonly 与服务端 canWrite=false 同一判定路径）：禁写
        page.evaluate('document.body.classList.add("kr-readonly");KGRecallTables.refreshControls()')
        assert page.locator(CELL).first.get_attribute('contenteditable')=='false','只读态仍可编辑'
        readonly_before=page.evaluate('JSON.stringify(KGRecallTables.tables)')
        assert not page.evaluate('KGRecallTables.insert(2,2)'),'只读态允许插入'
        assert page.evaluate('JSON.stringify(KGRecallTables.tables)')==readonly_before,'只读态表格被修改'
        page.close()

        assert not errors,errors
        browser.close()
        print('PASS: T19 三页表格 插入/编辑/移动/缩放/列宽/合并/Excel粘贴/空画布建表/Delete保护/单次撤销/保存重开/只读禁写')

if __name__=='__main__':main()
