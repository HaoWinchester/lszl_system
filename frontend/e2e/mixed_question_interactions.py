"""Exercise shared mixed-question controls in a real browser without a database."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content('<main id="editor"></main><main id="matching"></main>')
        for name in ['117-question-answer-set.js', '118-question-materials.js', '119-question-rich-editor.js']:
            page.add_script_tag(path=str(ROOT/'new-legacy/src'/name))
        page.evaluate('''() => {
          window.q={id:'q',type:'single_choice',options:[],images:[{id:'image',alt:'chart'}],
            material:{id:'m',revision:1,title:'案例',text:'材料',images:[]},caseGroup:{id:'m',order:1,total:3}};
          KGQuestionRichEditor.mount(document.querySelector('#editor'),q);
        }''')
        page.locator('[data-rich-order]').fill('2')
        page.locator('[data-rich-total]').fill('5')
        page.locator('[data-rich-remove-image]').click()
        if page.locator('[data-rich-order]').input_value()!='2' or page.locator('[data-rich-total]').input_value()!='5':
            failures.append('Removing a chart resets unsaved case order/total')
        page.evaluate('''() => {
          window.match={type:'matching',matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],
            right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}};
          window.control=KGQuestionMaterials.bind(document.querySelector('#matching'),{
            question:match,selectedPairs:{l1:'r2'}});
          const transfer=new DataTransfer();
          document.querySelector('[data-qm-left="l1"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
        }''')
        if page.evaluate('control.value().l1')!='r2':
            failures.append('Dropping unrelated content clears a previously selected match')
        for name in ['main.css', 'question-materials.css']:
            page.add_style_tag(path=str(ROOT/'new-legacy/styles'/name))
        page.evaluate('''() => {
          document.querySelector('#editor').remove();
          document.querySelector('#matching').style.maxWidth='760px';
          match.matching.left[0].text='销售团队了解项目，但反对当前交付安排，与交付团队目标不一致。'.repeat(3);
          match.matching.right[0].text='EngagementLevelWithAnUnbrokenIdentifier'.repeat(4);
          document.querySelector('#matching').innerHTML=KGQuestionMaterials.renderMatching(match);
        }''')
        for width in [1440, 390]:
            page.set_viewport_size({'width':width, 'height':1000})
            overflow = page.locator('.qm-target b,.qm-target span,.qm-candidate').evaluate_all(
                '(nodes) => nodes.filter(el => el.scrollWidth > el.clientWidth + 1).length')
            if overflow:
                failures.append(f'Long matching text overlaps its answer slot or overflows at {width}px')
        browser.close()
    assert not failures, '\n'.join(failures)
    print('PASS case editor draft, unrelated drag, and long matching text on desktop/mobile')

if __name__=='__main__':
    main()
