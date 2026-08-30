'use strict'

;(function (global) {
  const API = global.KGDomainApi
  if (!API?.request) throw new Error('教学内容 API 客户端未就绪')

  const clone = value => {
    if (value === undefined) return undefined
    try { return global.structuredClone ? global.structuredClone(value) : JSON.parse(JSON.stringify(value)) } catch (_error) { return value }
  }
  const clean = value => String(value ?? '').trim()
  const canonicalInput = value => clean(value).toUpperCase() === 'PMP' ? 'subject-pmp' : clean(value)
  const snapshots = new Map()
  const inflight = new Map()
  const aliases = new Map([['PMP', 'subject-pmp'], ['pmp', 'subject-pmp'], ['subject-pmp', 'subject-pmp']])
  let relationshipSnapshot = null
  let relationshipInflight = null
  let activeSubjectId = ''
  let activeGeneration = 0

  function selectedSubject(value) {
    if (clean(value)) return canonicalInput(value)
    try {
      return canonicalInput(new URLSearchParams(global.location?.search || '').get('subjectId')) || 'subject-pmp'
    } catch (_error) { return 'subject-pmp' }
  }

  function snapshotKey(value) {
    const selected = selectedSubject(value)
    return aliases.get(selected) || selected
  }

  function normalizeSnapshot(payload, requestedSubjectId) {
    const normalized = clone(payload || {})
    normalized.subjectId = canonicalInput(normalized.subjectId || requestedSubjectId) || 'subject-pmp'
    normalized.contentRevision = Number(normalized.contentRevision) || 0
    normalized.principles = clone(normalized.principles || { schemaVersion: 1, items: [] })
    normalized.synthesisPresets = clone(normalized.synthesisPresets || { schemaVersion: 1, items: [] })
    normalized.recallLibrary = clone(normalized.recallLibrary || { schemaVersion: 1, nodes: [], edges: [] })
    return normalized
  }

  function publish(type, detail) {
    try { global.dispatchEvent?.(new global.CustomEvent(type, { detail: clone(detail) })) } catch (_error) {}
  }

  function storeSnapshot(payload, requestedSubjectId, generation = null) {
    const normalized = normalizeSnapshot(payload, requestedSubjectId)
    const requested = selectedSubject(requestedSubjectId)
    const canonical = normalized.subjectId
    aliases.set(requested, canonical)
    snapshots.set(requested, clone(normalized))
    snapshots.set(canonical, clone(normalized))
    if (generation !== null && generation === activeGeneration) {
      activeSubjectId = canonical
      publish('kg:teaching-content-ready', { subjectId: canonical, contentRevision: normalized.contentRevision })
    }
    return clone(normalized)
  }

  async function fetchSnapshot(subject) {
    return API.request({ path: `/api/v1/content-prep/shared-content?subjectId=${encodeURIComponent(subject)}` })
  }

  async function fetchRelationships(force = false) {
    if (relationshipSnapshot && !force) return clone(relationshipSnapshot)
    if (!relationshipInflight || force) {
      relationshipInflight = Promise.all([
        API.request({ path: '/api/v1/course-management/drafts' }),
        API.request({ path: '/api/v1/course-management/releases' }),
        API.request({ path: '/api/v1/course-management/tasks' }),
        API.request({ path: '/api/v1/questions/reference-snapshot' }),
      ]).then(([draftResult, releaseResult, taskResult, referenceResult]) => {
        const courseDrafts = (draftResult?.drafts || []).map(row => ({
          ...clone(row.structure || {}), id: row.id, name: row.name,
          status: row.status, revision: row.revision,
          createdAt: row.createdAt, updatedAt: row.updatedAt,
        }))
        const courseReleases = clone(releaseResult?.releases || [])
        const tasks = (taskResult?.tasks || []).map(row => ({
          ...clone(row.content || {}), id: row.id, title: row.title,
          description: row.description, releaseId: row.releaseId,
          status: row.status, revision: row.revision,
          createdAt: row.createdAt, updatedAt: row.updatedAt,
        }))
        relationshipSnapshot = {
          courseDrafts, courseReleases, tasks,
          papers: clone(referenceResult?.papers || []),
          paperReleases: clone(referenceResult?.releases || []),
        }
        return clone(relationshipSnapshot)
      }).finally(() => { relationshipInflight = null })
    }
    return relationshipInflight
  }

  async function bootstrap(nextSubjectId, options = {}) {
    const requested = selectedSubject(nextSubjectId)
    const activate = options.activate !== false
    const generation = activate ? ++activeGeneration : null
    const requestedKey = snapshotKey(requested)
    if (activate) activeSubjectId = requestedKey
    if (!options.force && snapshots.has(requestedKey)) {
      const cached = storeSnapshot(snapshots.get(requestedKey), requested, generation)
      const relationships = options.relationships === true
        ? await fetchRelationships(options.force === true)
        : clone(relationshipSnapshot || {})
      return storeSnapshot({ ...cached, ...relationships }, requested, generation)
    }
    let pending = inflight.get(requested)
    if (!pending || options.force) {
      pending = fetchSnapshot(requested)
      inflight.set(requested, pending)
      pending.finally(() => { if (inflight.get(requested) === pending) inflight.delete(requested) }).catch(() => {})
    }
    try {
      const [payload, relationships] = await Promise.all([
        pending,
        options.relationships === true
          ? fetchRelationships(options.force === true)
          : Promise.resolve(clone(relationshipSnapshot || {})),
      ])
      return storeSnapshot({ ...payload, ...relationships }, requested, generation)
    } catch (error) {
      if (generation === activeGeneration) publish('kg:teaching-content-error', { subjectId: requested, message: error?.message || String(error) })
      throw error
    }
  }

  function activeSnapshot() {
    return snapshots.get(snapshotKey(activeSubjectId)) || null
  }

  function snapshot(nextSubjectId) {
    const value = clean(nextSubjectId) ? snapshots.get(snapshotKey(nextSubjectId)) : activeSnapshot()
    return clone(value || {})
  }

  const resourceField = Object.freeze({
    subjects: 'subjects', taxonomies: 'taxonomies', activityOverrides: 'activityOverrides',
    collections: 'activityCollections', tags: 'activityTags', principles: 'principles',
    synthesisPresets: 'synthesisPresets', recallLibrary: 'recallLibrary',
    courseDrafts: 'courseDrafts', courseReleases: 'courseReleases', tasks: 'tasks',
    papers: 'papers', paperReleases: 'paperReleases',
  })

  function readResource(name, fallback = null, nextSubjectId = '') {
    const current = clean(nextSubjectId) ? snapshots.get(snapshotKey(nextSubjectId)) : activeSnapshot()
    const field = resourceField[name] || name
    if (current && Object.prototype.hasOwnProperty.call(current, field)) return clone(current[field])
    if (name === 'taxonomies' && current?.knowledgeTree?.taxonomy) return [clone(current.knowledgeTree.taxonomy)]
    return clone(fallback)
  }

  function stageResource(name, value, nextSubjectId = '') {
    const current = clean(nextSubjectId) ? snapshots.get(snapshotKey(nextSubjectId)) : activeSnapshot()
    if (!current) return false
    const field = resourceField[name] || name
    const generation = snapshotKey(current.subjectId) === snapshotKey(activeSubjectId) ? activeGeneration : null
    storeSnapshot({ ...current, [field]: clone(value) }, current.subjectId, generation)
    publish('kg:teaching-content-memory-change', { subjectId: current.subjectId, name, value })
    return true
  }

  async function subjectContext(nextSubjectId, options = {}) {
    const data = await bootstrap(nextSubjectId || activeSubjectId || undefined, { ...options, activate: false })
    return { subjectId: data.subjectId, snapshot: data }
  }

  async function writeShared(context, overrides, { refreshConflict = false } = {}) {
    const request = current => API.request({
      method: 'PUT', path: '/api/v1/content-prep/shared-content',
      body: {
        subjectId: current.subjectId,
        contentRevision: Number(current.snapshot.contentRevision) || 0,
        ...clone(overrides),
      },
    })
    try {
      const saved = await request(context)
      const generation = snapshotKey(context.subjectId) === snapshotKey(activeSubjectId) ? activeGeneration : null
      return storeSnapshot(saved, context.subjectId, generation)
    } catch (error) {
      if (error?.status === 409 && refreshConflict) {
        await subjectContext(context.subjectId, { force: true })
      }
      throw error
    }
  }

  async function saveCatalogResource(name, value, nextSubjectId = '') {
    const field = resourceField[name] || name
    if (!['subjects', 'taxonomies', 'activityOverrides', 'activityTags', 'activityCollections'].includes(field)) {
      throw new Error(`不支持保存教学目录资源：${name}`)
    }
    const context = await subjectContext(nextSubjectId || activeSubjectId)
    const saved = await writeShared(context, { [field]: clone(value || []) }, { refreshConflict: true })
    return clone(saved[field] || [])
  }

  async function saveCatalog(resources, nextSubjectId = '') {
    const overrides = {}
    for (const [name, value] of Object.entries(resources || {})) {
      const field = resourceField[name] || name
      if (!['subjects', 'taxonomies', 'activityOverrides', 'activityTags', 'activityCollections'].includes(field)) throw new Error(`不支持保存教学目录资源：${name}`)
      overrides[field] = clone(value || [])
    }
    const context = await subjectContext(nextSubjectId || activeSubjectId)
    return writeShared(context, overrides, { refreshConflict: true })
  }

  async function saveRecallLibrary(nextSubjectId, input) {
    const context = await subjectContext(nextSubjectId || activeSubjectId)
    const identity = context.snapshot.recallLibrary || {}
    const library = {
      ...clone(input || {}), id: clean(input?.id || identity.id), subjectId: context.subjectId,
      version: Math.max(1, Number(input?.version || identity.version) || 1),
      status: clean(input?.status || identity.status) || 'published',
    }
    const saved = await writeShared(context, { recallLibrary: library })
    return clone(saved.recallLibrary || library)
  }

  function updatePrincipleSnapshots(result) {
    for (const [key, current] of snapshots.entries()) snapshots.set(key, normalizeSnapshot({ ...current, ...clone(result) }, current.subjectId))
    return clone(result)
  }

  async function listPrinciples() {
    const result = await API.request({ path: '/api/v1/content-prep/principles' })
    updatePrincipleSnapshots(result)
    return clone(result)
  }

  async function savePrinciple(principle, preset) {
    const context = await subjectContext(activeSubjectId)
    const id = clean(principle?.id)
    const existing = (context.snapshot.principles?.items || []).some(row => clean(row.id) === id)
    const result = await API.request({
      method: existing ? 'PUT' : 'POST',
      path: existing ? `/api/v1/content-prep/principles/${encodeURIComponent(id)}` : '/api/v1/content-prep/principles',
      body: { contentRevision: Number(context.snapshot.contentRevision) || 0, principle, preset },
    })
    updatePrincipleSnapshots(result)
    return clone(result)
  }

  async function deletePrinciple(id) {
    const context = await subjectContext(activeSubjectId)
    const result = await API.request({
      method: 'DELETE', path: `/api/v1/content-prep/principles/${encodeURIComponent(clean(id))}`,
      body: { contentRevision: Number(context.snapshot.contentRevision) || 0 },
    })
    updatePrincipleSnapshots(result)
    return clone(result)
  }

  async function mutatePrinciples(path, bodyValue) {
    const context = await subjectContext(activeSubjectId)
    try {
      await API.request({
        method: 'POST', path,
        body: { ...clone(bodyValue || {}), contentRevision: Number(context.snapshot.contentRevision) || 0 },
      })
    } catch (error) {
      if (error?.status === 409) await bootstrap(context.subjectId, { force: true })
      throw error
    }
    return listPrinciples()
  }

  async function importActivities(activities) {
    const context = await subjectContext(activeSubjectId)
    const result = await API.request({
      method: 'POST', path: '/api/v1/content-prep/activities/import',
      body: { contentRevision: Number(context.snapshot.contentRevision) || 0, activities: clone(activities || []) },
    })
    await bootstrap(context.subjectId, { force: true })
    return clone(result)
  }

  global.KGTeachingContentApi = Object.freeze({
    bootstrap, ready: bootstrap, snapshot, readResource, stageResource,
    saveRecallLibrary, listPrinciples,
    savePrinciple, deletePrinciple, importActivities,
    saveSubjects: value => saveCatalogResource('subjects', value),
    saveTaxonomies: value => saveCatalogResource('taxonomies', value),
    saveActivityOverrides: value => saveCatalogResource('activityOverrides', value),
    saveActivityTags: value => saveCatalogResource('activityTags', value),
    saveActivityCollections: value => saveCatalogResource('activityCollections', value),
    saveCatalogResource, saveCatalog,
    archivePrinciples: ids => mutatePrinciples('/api/v1/content-prep/principles/archive', { ids }),
    deletePrinciples: ids => mutatePrinciples('/api/v1/content-prep/principles/delete', { ids }),
    importPrinciples: bundle => mutatePrinciples('/api/v1/content-prep/principles/import', bundle),
    updatePrincipleStatuses: bodyValue => mutatePrinciples('/api/v1/content-prep/principles/status', bodyValue),
  })
})(window)
