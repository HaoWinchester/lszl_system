'use strict';

(function(global){
  function create(options={}){
    const model=options.model||global.KGGraphModel;
    const graph=()=>typeof options.getGraph==='function'?options.getGraph():null;
    const history=options.history||null;
    function uniqueIds(ids){return [...new Set(Array.isArray(ids)?ids:[...ids||[]])].filter(Boolean)}
    function updateDefaultsFromPatch(target,patch={}){
      const defaults={...(target.defaults||{})};
      const map={
        color:'nodeColor',fillColor:'nodeFillColor',fillOpacity:'nodeFillOpacity',borderVisible:'nodeBorderVisible',borderColor:'nodeBorderColor',borderWidth:'nodeBorderWidth',borderStyle:'nodeBorderStyle',borderOpacity:'nodeBorderOpacity',textColor:'nodeTextColor',textBackgroundColor:'nodeTextBackgroundColor',textBackgroundOpacity:'nodeTextBackgroundOpacity',size:'nodeSize',cardStyle:'nodeCardStyle',textAlign:'nodeTextAlign',fontSize:'nodeFontSize',fontFamily:'nodeFontFamily',fontWeight:'nodeFontWeight',fontStyle:'nodeFontStyle',underline:'nodeUnderline',strikeThrough:'nodeStrikeThrough',lineHeight:'nodeLineHeight'
      };
      Object.entries(map).forEach(([field,key])=>{if(Object.prototype.hasOwnProperty.call(patch,field))defaults[key]=patch[field]});
      target.defaults=defaults;
    }
    function mutate(label,section,ids,patch,renderMode){
      const target=graph();if(!target||!model)return[];
      const list=uniqueIds(ids);if(!list.length)return[];
      const work=()=>{
        const changed=model.updateNodes(target,list,section,patch);
        if(section==='appearance')updateDefaultsFromPatch(target,patch);
        return changed;
      };
      const changed=history&&typeof history.run==='function'?history.run(label,work):work();
      if(changed&&changed.length&&typeof options.onChange==='function')options.onChange({section,ids:list,patch,changed,renderMode:renderMode||section});
      return changed||[];
    }
    function updateAppearance(ids,patch,label='修改卡牌外观'){return mutate(label,'appearance',ids,patch,'appearance')}

    function applyCardStyle(ids,cardStyle,label='切换节点类型'){
      const target=graph();if(!target||!model)return[];
      const list=uniqueIds(ids);if(!list.length)return[];
      const defaults=typeof model.defaultsForCardStyle==='function'?model.defaultsForCardStyle(cardStyle):{};
      const work=()=>{
        const changed=[];
        for(const id of list){
          const node=model.findNode(target,id);if(!node)continue;
          const current=model.appearanceOf(node);
          const centeredStyles=new Set(['rounded','rectangle','circle','triangle']);
          model.updateAppearance(node,{cardStyle,...defaults,surfaceCustomized:false,color:current.color,textAlign:centeredStyles.has(cardStyle)?'center':current.textAlign,fontSize:current.fontSize,fontFamily:current.fontFamily,fontWeight:current.fontWeight,fontStyle:current.fontStyle,underline:current.underline,strikeThrough:current.strikeThrough,lineHeight:current.lineHeight,textBackgroundColor:current.textBackgroundColor,textBackgroundOpacity:current.textBackgroundOpacity});
          if(cardStyle==='circle'&&typeof model.geometryOf==='function'&&typeof model.updateGeometry==='function'){
            const geometry=model.geometryOf(node),side=Math.max(geometry.width,geometry.height);
            model.updateGeometry(node,{x:Math.round(geometry.x+(geometry.width-side)/2),y:Math.round(geometry.y+(geometry.height-side)/2),width:side,height:side});
          }
          changed.push(node);
        }
        if(changed.length)updateDefaultsFromPatch(target,{cardStyle,...defaults});
        return changed;
      };
      const changed=history&&typeof history.run==='function'?history.run(label,work):work();
      if(changed&&changed.length&&typeof options.onChange==='function')options.onChange({section:'appearance',ids:list,patch:{cardStyle,...defaults},changed,renderMode:'appearance'});
      return changed||[];
    }
    function updateContent(ids,patch,label='修改卡牌内容'){return mutate(label,'content',ids,patch,'content')}
    function updateGeometry(ids,patch,label='修改卡牌位置'){return mutate(label,'geometry',ids,patch,'geometry')}
    function resetAppearance(ids,cardStyle,label='恢复卡牌默认样式'){
      const target=graph();if(!target||!model)return[];
      const list=uniqueIds(ids);if(!list.length)return[];
      const work=()=>{
        const changed=[];
        for(const id of list){const node=model.findNode(target,id);if(!node)continue;model.resetAppearanceToCardStyle(node,cardStyle||model.appearanceOf(node).cardStyle);changed.push(node)}
        if(changed.length){const appearance=model.appearanceOf(changed[0]);updateDefaultsFromPatch(target,appearance)}
        return changed;
      };
      const changed=history&&typeof history.run==='function'?history.run(label,work):work();
      if(changed&&changed.length&&typeof options.onChange==='function')options.onChange({section:'appearance',ids:list,patch:{reset:true,cardStyle},changed,renderMode:'appearance'});
      return changed||[];
    }
    function updateDefaultAppearance(patch,label='修改默认卡牌样式'){
      const target=graph();if(!target)return false;
      const work=()=>{
        const style=patch.nodeCardStyle||patch.cardStyle;
        const styleDefaults=style&&model&&typeof model.defaultsForCardStyle==='function'?model.defaultsForCardStyle(style):null;
        const stylePatch=styleDefaults?{
          nodeFillColor:styleDefaults.fillColor,nodeFillOpacity:styleDefaults.fillOpacity,nodeBorderVisible:styleDefaults.borderVisible,
          nodeBorderColor:styleDefaults.borderColor,nodeBorderWidth:styleDefaults.borderWidth,nodeBorderStyle:styleDefaults.borderStyle,
          nodeBorderOpacity:styleDefaults.borderOpacity,nodeTextColor:styleDefaults.textColor,nodeTextBackgroundColor:styleDefaults.textBackgroundColor,nodeTextBackgroundOpacity:styleDefaults.textBackgroundOpacity,nodeFontSize:styleDefaults.fontSize,nodeFontFamily:styleDefaults.fontFamily,nodeFontWeight:styleDefaults.fontWeight,nodeFontStyle:styleDefaults.fontStyle,nodeUnderline:styleDefaults.underline,nodeStrikeThrough:styleDefaults.strikeThrough,nodeLineHeight:styleDefaults.lineHeight
        }:{};
        target.defaults={...(target.defaults||{}),...stylePatch,...patch};updateDefaultsFromPatch(target,patch);return true
      };
      const result=history&&typeof history.run==='function'?history.run(label,work):work();
      if(result&&typeof options.onChange==='function')options.onChange({section:'defaults',patch,renderMode:'header'});return !!result;
    }
    return Object.freeze({updateAppearance,applyCardStyle,updateContent,updateGeometry,resetAppearance,updateDefaultAppearance});
  }
  global.KGGraphStyleController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
