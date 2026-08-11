'use strict';

(function(global){
  function create(options={}){
    const state=()=>typeof options.getState==='function'?options.getState():{};
    const node= id=>typeof options.getNode==='function'?options.getNode(id):null;
    const exists=(a,b)=>typeof options.relationExists==='function'&&options.relationExists(a,b);
    function source(){return state().linkSourceId||null}
    function setSource(id){
      if(!node(id))return false;
      const s=state();s.selectedNodeId=id;s.selectedLinkId=null;s.linkSourceId=id;
      if(typeof options.onChange==='function')options.onChange({type:'source',sourceId:id});return true;
    }
    function cancel(){const s=state();const had=!!s.linkSourceId;s.linkSourceId=null;if(had&&typeof options.onChange==='function')options.onChange({type:'cancel'});return had}
    function connectTo(targetId){
      const s=state(),sourceId=s.linkSourceId;
      if(!sourceId||sourceId===targetId||!node(sourceId)||!node(targetId))return{ok:false,code:'INVALID_TARGET'};
      if(exists(sourceId,targetId)){s.linkSourceId=null;return{ok:false,code:'DUPLICATE',sourceId,targetId}}
      const link=typeof options.createLink==='function'?options.createLink(sourceId,targetId):null;
      if(!link)return{ok:false,code:'CREATE_FAILED',sourceId,targetId};
      if(typeof options.addLink==='function')options.addLink(link);
      s.selectedNodeId=null;s.selectedLinkId=link.id||null;s.linkSourceId=null;
      if(typeof options.onChange==='function')options.onChange({type:'connect',sourceId,targetId,link});
      return{ok:true,sourceId,targetId,link};
    }
    return Object.freeze({source,setSource,cancel,connectTo});
  }
  global.KGGraphConnectionController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
