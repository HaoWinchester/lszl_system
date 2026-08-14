/* Database-backed shared Content Prep draft client. */
(function(global){
  function api(){
    const service=global.PMPPrepServerCatalogService;
    if(!service?.request)throw new Error('共享草稿服务尚未就绪。');
    return service;
  }
  async function list(){return (await api().request('/content-prep/drafts')).drafts||[]}
  async function create(input){return (await api().request('/content-prep/drafts',{method:'POST',body:JSON.stringify(input)})).draft}
  async function get(id){return (await api().request(`/content-prep/drafts/${encodeURIComponent(id)}`)).draft}
  async function save(id,input){return (await api().request(`/content-prep/drafts/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)})).draft}
  async function remove(id){return api().request(`/content-prep/drafts/${encodeURIComponent(id)}`,{method:'DELETE'})}
  async function sync(id,input){return (await api().request(`/content-prep/drafts/${encodeURIComponent(id)}/sync`,{method:'POST',body:JSON.stringify(input)})).result}
  global.PMPPrepSharedDrafts=Object.freeze({list,create,get,save,remove,sync});
})(window);
