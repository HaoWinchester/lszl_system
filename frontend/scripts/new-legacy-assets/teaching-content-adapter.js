'use strict'

;(function (global) {
  const API = global.KGDomainApi
  if (!API?.request) throw new Error('教学内容 API 客户端未就绪')

  const clone = value => {
    if (value === undefined) return undefined
    try { return global.structuredClone ? global.structuredClone(value) : JSON.parse(JSON.stringify(value)) } catch (_error) { return value }
  }
  const clean = value => String(value ?? '').trim()
  const resources = Object.create(null)
  let snapshot = null
  let subjectId = ''
  let bootstrapPromise = null

  function selectedSubject(value) {
    if (clean(value)) return clean(value)
    try {
      return clean(new URLSearchParams(global.location?.search || '').get('subjectId')) || 'subject-pmp'
    } catch (_error) { return 'subject-pmp' }
  }

  function apply(payload) {
    snapshot = clone(payload || {})
    subjectId = clean(snapshot.subjectId) || subjectId || 'subject-pmp'
    resources.subjects = clone(snapshot.subjects || [])
    resources.taxonomies = clone(snapshot.taxonomies || (snapshot.knowledgeTree?.taxonomy ? [snapshot.knowledgeTree.taxonomy] : []))
    resources.activityOverrides = clone(snapshot.activityOverrides || [])
    resources.collections = clone(snapshot.activityCollections || [])
    resources.tags = clone(snapshot.activityTags || [])
    resources.principles = clone(snapshot.principles || { schemaVersion: 1, items: [] })
    resources.synthesisPresets = clone(snapshot.synthesisPresets || { schemaVersion: 1, items: [] })
    resources.recallLibrary = clone(snapshot.recallLibrary || { schemaVersion: 1, nodes: [], edges: [] })
    return clone(snapshot)
  }

  async function fetchSnapshot(nextSubjectId) {
    const selected = selectedSubject(nextSubjectId || subjectId)
    return API.request({
      path: `/api/v1/content-prep/shared-content?subjectId=${encodeURIComponent(selected)}`,
    })
  }

  async function bootstrap(nextSubjectId) {
    const selected = selectedSubject(nextSubjectId)
    if (bootstrapPromise && selected === subjectId) return bootstrapPromise
    subjectId = selected
    bootstrapPromise = fetchSnapshot(selected).then(apply).finally(() => { bootstrapPromise = null })
    return bootstrapPromise
  }

  function readResource(name, fallback = null) {
    return Object.prototype.hasOwnProperty.call(resources, name)
      ? clone(resources[name])
      : clone(fallback)
  }

  function stageResource(name, value) {
    resources[name] = clone(value)
    try {
      global.dispatchEvent?.(new global.CustomEvent('kg:teaching-content-memory-change', {
        detail: { name, value: clone(value) },
      }))
    } catch (_error) {}
    return true
  }

  function body(overrides = {}) {
    return {
      subjectId: subjectId || 'subject-pmp',
      contentRevision: Number(snapshot?.contentRevision) || 0,
      ...overrides,
    }
  }

  async function putShared(overrides) {
    try {
      return apply(await API.request({ method: 'PUT', path: '/api/v1/content-prep/shared-content', body: body(overrides) }))
    } catch (error) {
      if (error?.status !== 409) throw error
      apply(await fetchSnapshot(subjectId))
      return apply(await API.request({ method: 'PUT', path: '/api/v1/content-prep/shared-content', body: body(overrides) }))
    }
  }

  async function saveTaxonomy(input) {
    const taxonomy = clone(input || {})
    await putShared({ knowledgeTree: { taxonomy } })
    return clone(snapshot?.knowledgeTree?.taxonomy || taxonomy)
  }

  async function releaseTaxonomy(id, revision) {
    const taxonomy = (resources.taxonomies || []).find(row => clean(row.id) === clean(id))
    if (!taxonomy) throw new Error('知识树不存在')
    if (revision !== undefined && Number(snapshot?.contentRevision) !== Number(revision)) {
      snapshot.contentRevision = Number(revision)
    }
    return saveTaxonomy({ ...taxonomy, status: 'published', isDefault: true })
  }

  async function saveRecallLibrary(nextSubjectId, input) {
    subjectId = selectedSubject(nextSubjectId || subjectId)
    const library = clone(input || {})
    const result = await API.request({
      method: 'PUT',
      path: `/api/v1/content-prep/recall-libraries/${encodeURIComponent(subjectId)}`,
      body: {
        version: Math.max(1, Number(library.version) || 1),
        nodes: clone(library.nodes || []),
        edges: clone(library.edges || []),
        metadata: clone(library.metadata || {}),
      },
    })
    snapshot = { ...(snapshot || {}), contentRevision: Number(result.contentRevision) || Number(snapshot?.contentRevision) || 0, recallLibrary: clone(result.library) }
    resources.recallLibrary = clone(result.library)
    return clone(result.library)
  }

  async function listPrinciples() {
    const result = await API.request({ path: '/api/v1/content-prep/principles' })
    snapshot = { ...(snapshot || {}), ...clone(result) }
    resources.principles = clone(result.principles || { schemaVersion: 1, items: [] })
    resources.synthesisPresets = clone(result.synthesisPresets || { schemaVersion: 1, items: [] })
    return clone(result)
  }

  async function savePrinciple(principle, preset) {
    const id = clean(principle?.id)
    const existing = (resources.principles?.items || []).some(row => clean(row.id) === id)
    const result = await API.request({
      method: existing ? 'PUT' : 'POST',
      path: existing ? `/api/v1/content-prep/principles/${encodeURIComponent(id)}` : '/api/v1/content-prep/principles',
      body: { contentRevision: Number(snapshot?.contentRevision) || 0, principle, preset },
    })
    snapshot = { ...(snapshot || {}), ...clone(result) }
    resources.principles = clone(result.principles)
    resources.synthesisPresets = clone(result.synthesisPresets)
    return clone(result)
  }

  async function deletePrinciple(id) {
    const result = await API.request({
      method: 'DELETE', path: `/api/v1/content-prep/principles/${encodeURIComponent(clean(id))}`,
      body: { contentRevision: Number(snapshot?.contentRevision) || 0 },
    })
    snapshot = { ...(snapshot || {}), ...clone(result) }
    resources.principles = clone(result.principles)
    resources.synthesisPresets = clone(result.synthesisPresets)
    return clone(result)
  }

  async function importActivities(activities) {
    const result = await API.request({
      method: 'POST', path: '/api/v1/content-prep/activities/import',
      body: { contentRevision: Number(snapshot?.contentRevision) || 0, activities: clone(activities || []) },
    })
    return apply(await fetchSnapshot(subjectId)) && clone(result)
  }

  global.KGTeachingContentApi = Object.freeze({
    bootstrap,
    ready: bootstrap,
    snapshot: () => clone(snapshot || {}),
    readResource,
    stageResource,
    saveTaxonomy,
    releaseTaxonomy,
    saveRecallLibrary,
    listPrinciples,
    savePrinciple,
    deletePrinciple,
    importActivities,
    archivePrinciples: ids => API.request({ method: 'POST', path: '/api/v1/content-prep/principles/archive', body: { ids } }),
    importPrinciples: bundle => API.request({ method: 'POST', path: '/api/v1/content-prep/principles/import', body: bundle }),
    updatePrincipleStatuses: bodyValue => API.request({ method: 'POST', path: '/api/v1/content-prep/principles/status', body: bodyValue }),
  })
  bootstrap().catch(() => {})
})(window)
