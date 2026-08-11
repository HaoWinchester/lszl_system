'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};const Core=root.Core;
  const normalize=(category,index=0)=>({id:String(category?.id||Core.createId('paper-category')),name:String(category?.name||`分类 ${index+1}`).trim()||`分类 ${index+1}`,createdAt:Number(category?.createdAt||Date.now()),updatedAt:Number(category?.updatedAt||Date.now())});
  function create(options={}){
    const load=()=>{const rows=options.read?.()||[];return Array.isArray(rows)?rows.map(normalize):[]};
    const save=rows=>options.write?.((rows||[]).map(normalize))!==false;
    function add(rows,name){const clean=String(name||'').trim();if(!clean)return Core.result(false,null,['分类名称不能为空。']);if(rows.some(item=>item.name===clean))return Core.result(false,null,['已存在同名分类。']);const next=[...rows,normalize({name:clean})];return save(next)?Core.result(true,next):Core.result(false,null,['保存试卷分类失败。'])}
    function rename(rows,id,name){const clean=String(name||'').trim();if(!clean)return Core.result(false,null,['分类名称不能为空。']);if(rows.some(item=>item.id!==id&&item.name===clean))return Core.result(false,null,['已存在同名分类。']);const next=rows.map(item=>item.id===id?{...item,name:clean,updatedAt:Date.now()}:item);return save(next)?Core.result(true,next):Core.result(false,null,['保存试卷分类失败。'])}
    function remove(rows,papers,id){const nextCategories=rows.filter(item=>item.id!==id),nextPapers=papers.map(paper=>paper.categoryId===id?{...paper,categoryId:'',updatedAt:Date.now()}:paper);if(options.writeAll){const ok=options.writeAll(nextCategories,nextPapers);return ok===false?Core.result(false,null,['删除分类失败，修改已回滚。']):Core.result(true,{categories:nextCategories,papers:nextPapers})}if(!save(nextCategories))return Core.result(false,null,['删除分类失败。']);return Core.result(true,{categories:nextCategories,papers:nextPapers})}
    return Object.freeze({load,save,add,rename,remove,normalize});
  }
  root.PaperManagement=root.PaperManagement||{};root.PaperManagement.PaperCategoryService=Object.freeze({create,normalize});
})(globalThis);
