#!/usr/bin/env python3
"""Verify graph/workspace SVG hit strokes stay screen-fixed at 100/200/400%."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

def check(page,css_file,selector,expected_width):
    page.set_content('<!doctype html><html><head></head><body></body></html>')
    page.add_style_tag(content=(ROOT/css_file).read_text(encoding='utf-8'))
    result=page.evaluate("""({selector,expectedWidth})=>{
      const host=document.createElement('div');
      Object.assign(host.style,{position:'fixed',left:'20px',top:'20px',width:'900px',height:'300px',zIndex:'2147483647',background:'white'});
      const ns='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(ns,'svg');svg.setAttribute('width','900');svg.setAttribute('height','300');if(selector.includes('qw-'))svg.setAttribute('class','qw-edge-layer');host.appendChild(svg);document.body.appendChild(host);
      const rows=[];
      [1,2,4].forEach((zoom,index)=>{
        const g=document.createElementNS(ns,'g');g.setAttribute('transform',`translate(20 ${45+index*80}) scale(${zoom})`);
        const line=document.createElementNS(ns,'line');line.setAttribute('x1','10');line.setAttribute('x2',String(160/zoom));line.setAttribute('y1','0');line.setAttribute('y2','0');line.setAttribute('class',selector.slice(1));
        g.appendChild(line);svg.appendChild(g);rows.push({zoom,line});
      });
      return rows.map(row=>{
        const rect=row.line.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
        return {zoom:row.zoom,near:document.elementFromPoint(x,y+Math.max(2,expectedWidth/2-2))===row.line,far:document.elementFromPoint(x,y+expectedWidth/2+7)===row.line,vector:getComputedStyle(row.line).vectorEffect};
      });
    }""",{'selector':selector,'expectedWidth':expected_width})
    for item in result:
        assert item['vector']=='non-scaling-stroke',item
        assert item['near'],f"near point should hit at {item['zoom']*100}%: {item}"
        assert not item['far'],f"far point should miss at {item['zoom']*100}%: {item}"

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1200,'height':800})
    check(page,'styles/main.css','.edge-hit',28)
    check(page,'styles/question-workspace.css','.qw-edge-hit',18)
    browser.close()
print('v862-p2238-edge-hit-zoom-browser-ok')
