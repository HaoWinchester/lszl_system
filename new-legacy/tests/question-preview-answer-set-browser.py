#!/usr/bin/env python3
"""Exercise both real preview row handlers and renderers in a browser component harness."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/65-question-bank-admin.js").read_text()


def section(start, end):
    return source[source.index(start):source.index(end)]


functions = "\n".join([
    section("  function openLibraryQuestionPreview(", "  function editLibraryQuestionFromPreview("),
    section("  async function openPaperQuestionPreview(", "  function openQuestionEditorFromPreview("),
])

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_content('''<html><body><div id="rows"></div>
      <aside id="qbLibraryQuestionPreviewPopover" hidden><h2 id="qbLibraryQuestionPreviewTitle"></h2>
        <div id="qbLibraryQuestionPreviewMeta"></div><div id="qbLibraryQuestionPreviewContent"></div>
        <button id="qbLibraryQuestionPreviewEditBtn">编辑</button></aside>
      <aside id="qbQuestionPreviewPopover" hidden><h2 id="qbQuestionPreviewTitle"></h2>
        <div id="qbQuestionPreviewMeta"></div><div id="qbQuestionPreviewContent"></div></aside>
      </body></html>''')
    for file in ["teacher/question-bank/question-preview.js", "117-question-answer-set.js"]:
        page.add_script_tag(content=(ROOT / "src" / file).read_text())
    # Only unrelated editor, metadata and popover-positioning effects are replaced.
    # Answer normalization, shared view model, HTML renderer and row event handlers are real source.
    page.add_script_tag(content="""
    const $=id=>document.getElementById(id),AnswerSet=KGQuestionAnswerSet;
    const fixtures=[
      {id:'Q90',type:'multiple_choice',correctOptionIds:['A','C','D'],options:[...'ABCDEF'].map(id=>({id,text:id}))},
      {id:'mini136',type:'multiple_choice',correctOptionIds:['B','E'],options:[...'ABCDE'].map(id=>({id,text:id}))},
      {id:'single',type:'single_choice',correctAnswer:'B',options:[...'ABCD'].map(id=>({id,text:id}))},
      {id:'matching',type:'matching',correctAnswer:'A',options:[{id:'A',text:'旧占位',correct:true},{id:'B',text:'旧占位'}],
        matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}},
      {id:'unset',type:'multiple_choice',options:[...'ABCDE'].map(id=>({id,text:id}))}
    ].map(q=>({...q,title:q.id,stemParts:[{text:'题干'}],analysis:'解析'}));
    const bank={id:'bank',name:'题库',questions:fixtures},state={banks:[bank]},Catalog={},noop=()=>{};
    const currentBank=()=>bank,teacherDomainServices=()=>({questionPreview:KGTeacherDomains.QuestionBank.QuestionPreview}),
      stemText=q=>q.stemParts.map(p=>p.text).join(''),fillQuestionForm=noop,renderRecallConfig=noop,
      renderStatusCard=noop,renderCompletion=noop,questionKnowledgeLabel=()=>'',questionDomainKey=()=>'',
      questionTypeLabel=type=>type,difficultyDisplay=()=>'',isQuestionDeleted=()=>false,
      markLibraryQuestionPreviewAnchor=noop,markPaperPreviewAnchor=noop,positionLibraryQuestionPreview=noop,
      positionPaperQuestionPreview=noop,selectQuestion=noop,escapeHTML=value=>String(value),
      toast=message=>{throw Error(message)};
    const isLibraryQuestionPreviewOpen=()=>!$('qbLibraryQuestionPreviewPopover').hidden,
      libraryPreviewKey=()=>state.libraryPreviewRef?.questionId||'',
      isPaperQuestionPreviewOpen=()=>!$('qbQuestionPreviewPopover').hidden,
      paperPreviewKey=()=>state.paperPreviewRef?paperRefKey(state.paperPreviewRef):'',
      paperRefKey=ref=>ref.bankId+'::'+ref.questionId,
      paperQuestionLookup=ref=>({bank,question:fixtures.find(q=>q.id===ref.questionId)});
    $('qbLibraryQuestionPreviewPopover').hidden=true;$('qbQuestionPreviewPopover').hidden=true;
    """ + functions + """
    for(const fixture of fixtures){for(const surface of ['library','paper']){
      const row=document.createElement('div');row.textContent=surface+' '+fixture.id;row.dataset.testRow=surface+'-'+fixture.id;
      if(surface==='library'){row.dataset.libraryQuestionPreview=fixture.id;bindLibraryQuestionPreviewRow(row)}
      else{row.dataset.questionPreview='bank::'+fixture.id;bindPaperPreviewRow(row)}$('rows').append(row)
    }}
    """)
    checks = 0
    for surface, popover, content, prefix in [
        ("library", "qbLibraryQuestionPreviewPopover", "qbLibraryQuestionPreviewContent", "qb-library-preview"),
        ("paper", "qbQuestionPreviewPopover", "qbQuestionPreviewContent", "pm-preview"),
    ]:
        for question_id, answer, correct in [
            ("Q90", "A、C、D", ["A", "C", "D"]),
            ("mini136", "B、E", ["B", "E"]),
            ("single", "B", ["B"]),
            ("matching", "1 → 乙；2 → 甲", []),
            ("unset", "未设置", []),
        ]:
            row = page.locator(f'[data-test-row="{surface}-{question_id}"]')
            row.dblclick()
            assert page.locator("#" + popover).is_visible()
            assert page.locator(f"#{content} .{prefix}-answer").inner_text() == answer
            assert page.locator(f"#{content} .{prefix}-option.correct b").all_text_contents() == correct
            row.dblclick()
            assert page.locator("#" + popover).is_hidden()
            checks += 1
    assert not errors, errors
    browser.close()
    print(f"question preview browser component interactions: {checks}/10 passed (open, answer/highlights, close)")
