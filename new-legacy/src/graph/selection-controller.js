'use strict';

(function(global){
  function create(options={}){
    const nodeSet=()=>typeof options.getNodeSet==='function'?options.getNodeSet():new Set();
    const linkSet=()=>typeof options.getLinkSet==='function'?options.getLinkSet():new Set();
    const setNodeSet=value=>typeof options.setNodeSet==='function'&&options.setNodeSet(value);
    const setLinkSet=value=>typeof options.setLinkSet==='function'&&options.setLinkSet(value);
    const state=()=>typeof options.getState==='function'?options.getState():{};
    function clearMulti(){nodeSet().clear();linkSet().clear();emit('clear-multi')}
    function clearAll(){
      clearMulti();const s=state();s.selectedNodeId=null;s.selectedLinkId=null;s.linkSourceId=null;emit('clear-all');return true;
    }
    function toggleNode(id,options2={}){
      const nodes=nodeSet(),links=linkSet(),s=state();
      links.clear();s.selectedLinkId=null;s.linkSourceId=null;
      if(options2.seedPrimary!==false&&s.selectedNodeId&&s.selectedNodeId!==id&&!nodes.size)nodes.add(s.selectedNodeId);
      if(nodes.has(id))nodes.delete(id);else nodes.add(id);
      s.selectedNodeId=nodes.size?[...nodes][0]:null;
      emit('toggle-node');return snapshot();
    }
    function selectNodes(ids,{primary}={}){
      const valid=[...new Set(Array.isArray(ids)?ids:[])];setNodeSet(new Set(valid));linkSet().clear();
      const s=state();s.selectedNodeId=primary&&valid.includes(primary)?primary:(valid[0]||null);s.selectedLinkId=null;s.linkSourceId=null;emit('select-nodes');return snapshot();
    }
    function selectLink(id){clearMulti();const s=state();s.selectedNodeId=null;s.selectedLinkId=id||null;s.linkSourceId=null;emit('select-link');return snapshot()}
    function snapshot(){const s=state();return{selectedNodeId:s.selectedNodeId||null,selectedLinkId:s.selectedLinkId||null,linkSourceId:s.linkSourceId||null,selectedNodeIds:[...nodeSet()],selectedLinkIds:[...linkSet()]}}
    function restore(value={},validators={}){
      const validNode=typeof validators.node==='function'?validators.node:()=>true,validLink=typeof validators.link==='function'?validators.link:()=>true;
      const nodes=(value.selectedNodeIds||[]).filter(validNode),links=(value.selectedLinkIds||[]).filter(validLink);
      setNodeSet(new Set(nodes));setLinkSet(new Set(links));
      const s=state();s.selectedNodeId=validNode(value.selectedNodeId)?value.selectedNodeId:null;s.selectedLinkId=validLink(value.selectedLinkId)?value.selectedLinkId:null;s.linkSourceId=validNode(value.linkSourceId)?value.linkSourceId:null;emit('restore');return snapshot();
    }
    function emit(type){if(typeof options.onChange==='function')options.onChange({type,snapshot:snapshot()})}
    return Object.freeze({clearMulti,clearAll,toggleNode,selectNodes,selectLink,snapshot,restore});
  }
  global.KGGraphSelectionController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
