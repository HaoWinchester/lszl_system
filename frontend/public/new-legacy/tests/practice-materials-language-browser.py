"""Real practice DOM language cycle for case materials and matching; fixture API only."""
from pathlib import Path
from playwright.sync_api import expect
ROOT=Path(__file__).resolve().parents[1]
setup=(ROOT/'tests/practice-mark-show-answers-browser.py').read_text().split('    # ---------- 场景 1：')[0]
setup=setup.replace('"src/118-question-materials.js",','"src/86-free-mode-language.js",\n    "src/118-question-materials.js",')
needle="const allRefs=Array.from"
setup=setup.replace(needle,"""const originalQuestion=question;
          const bilingualQuestion=index=>{
            const q=originalQuestion(index);q.translations={en:{stemParts:[{text:'Question '+index+' in English'}],analysis:'Explanation '+index+' in English',options:[{id:'B',text:'Wrong choice'},{id:'A',text:'Correct choice'}]}};
            if(index===1){q.material={id:'case-1',title:'案例材料',text:'中文案例全文',images:[]};q.translations.en.material={title:'Case material',text:'Complete English scenario'};}
            if(index===2){q.type='matching';q.options=[];q.matching={left:[{id:'l1',text:'项目经理'},{id:'l2',text:'发起人'}],right:[{id:'r1',text:'提供资源'},{id:'r2',text:'负责目标'}],correctPairs:{l1:'r2',l2:'r1'}};q.translations.en.matching={left:[{id:'l2',text:'Sponsor'},{id:'l1',text:'Project manager'}],right:[{id:'r2',text:'Accountable for objectives'},{id:'r1',text:'Provides resources'}]};}
            return q;
          };
          const allRefs=Array.from""")
setup=setup.replace('window.KGActivitySchemaV1={','window.KGActivitySchemaV1={normalizeStudentLanguageMode:value=>value==="en"?"bilingual":value,')
setup=setup.replace('question:question(offset+1)','question:bilingualQuestion(offset+1)')
scenario='''
    page.locator('[data-practice-start="practice"]').click()
    expect(page.locator('#practiceQuestionStem')).to_have_text('这是第 1 道题')
    cycle=page.locator('#practiceLanguageCycle')
    cycle.click()
    expect(page.locator('#practiceQuestionStem')).to_have_text('Question 1 in English')
    expect(page.locator('.qm-case summary')).to_have_text('Case material')
    expect(page.locator('.qm-case .qm-text')).to_have_text('Complete English scenario')
    expect(page.locator('[data-option-id="A"]')).to_contain_text('Correct choice')
    page.locator('#practiceShowAnswers').check()
    expect(page.locator('#practiceExplanationBody')).to_contain_text('Explanation 1 in English')
    cycle.click()
    expect(page.locator('.qm-case .qm-text')).to_contain_text('中文案例全文')
    expect(page.locator('.qm-case .qm-text .qm-language-en')).to_contain_text('Complete English scenario')
    cycle.click()
    page.locator('#practiceShowAnswers').uncheck()
    page.locator('#practiceAnswerSheetMobileBtn').click()
    page.locator('#practiceAnswerSheet [data-question-id="q2"]').click()
    page.locator('[data-qm-left="l1"]').click()
    page.locator('[data-qm-right="r2"]').click()
    cycle.click()
    expect(page.locator('[data-qm-left="l1"]')).to_contain_text('Project manager')
    expect(page.locator('[data-qm-left="l1"]')).to_contain_text('Accountable for objectives')
    cycle.click()
    for width in [320,390,1440]:
        page.set_viewport_size({'width':width,'height':960})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        # English lines must not inherit the answer-slot border/minimum height.
        assert page.locator('.qm-target .qm-language-en').first.evaluate("e=>getComputedStyle(e).borderTopStyle==='none'&&getComputedStyle(e).minHeight==='0px'"),width
    page.locator('[data-qm-left="l2"]').click()
    page.locator('[data-qm-right="r1"]').click()
    page.locator('#practiceShowAnswers').check()
    expect(page.locator('.qm-pair.is-correct')).to_have_count(2)
    expect(page.locator('.qm-pair')).to_contain_text(['Project manager','Sponsor'])
    assert not errors,errors
    browser.close()
'''
exec(compile(setup+scenario,str(__file__),'exec'))
print('Case and matching: real language cycle, ID lookup, answer display, selection retention, escaping and 320/390/1440 layout PASS')
