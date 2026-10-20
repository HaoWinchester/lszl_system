const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../src/118-question-materials.js');
test('read-only discovery preview includes matching candidates and materials with escaped text and safe media',()=>{
 const html=global.KGQuestionMaterials.renderPreview({stem:'题干 <安全>',options:[{id:'A',text:'选项'}],material:{id:'m',title:'案例',text:'案例正文'},matching:{left:[{id:'l',text:'左项'}],right:[{id:'r',text:'右项'}],correctPairs:{l:'r'}},images:[{url:'/api/v1/question-assets/qa_preview',alt:'图表'},{url:'javascript:alert(1)',alt:'危险'}]});
 assert.match(html,/案例正文/);assert.match(html,/左项/);assert.match(html,/右项/);assert.match(html,/&lt;安全&gt;/);assert.match(html,/question-assets\/qa_preview/);assert.doesNotMatch(html,/javascript:|correctPairs|配对正确/);
});
