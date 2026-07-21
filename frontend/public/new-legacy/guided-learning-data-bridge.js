'use strict'

;(function (global) {
  const bootstrap = global.KGServerStateBootstrap?.state || {}
  const pkg = bootstrap.guidedCoursePackage
  if (!pkg?.course || !Array.isArray(pkg.activities)) return

  const schema = global.KGActivitySchemaV1
  const allowedLanguages = ['zh','en','bilingual']
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const library = Object.fromEntries(pkg.activities.map((activity) => [String(activity.id), clone(activity)]))
  const course = { ...clone(pkg.course), activities: clone(library) }

  function languageMode(mode) {
    const requested = String(mode || schema?.getLanguageMode?.() || 'zh')
    return allowedLanguages.includes(requested) ? requested : 'zh'
  }
  function orderedNodes() {
    const stageOrder = new Map(course.stages.map((stage) => [stage.id, Number(stage.order || 0)]))
    const partOrder = new Map(course.parts.map((part) => [part.id, {
      stage: stageOrder.get(part.stageId) || 0,
      part: Number(part.order || 0),
    }]))
    return [...course.nodes].sort((left, right) => {
      const a = partOrder.get(left.partId) || { stage: 0, part: 0 }
      const b = partOrder.get(right.partId) || { stage: 0, part: 0 }
      return a.stage - b.stage || a.part - b.part || Number(left.order || 0) - Number(right.order || 0)
    })
  }
  function activityById(activityId, mode) {
    const activity = library[String(activityId || '')]
    return activity && schema?.materialize ? schema.materialize(activity, languageMode(mode)) : clone(activity || null)
  }
  function activitiesForNode(nodeId, mode) {
    const node = course.nodes.find((item) => String(item.id) === String(nodeId || ''))
    return node ? (node.activityIds || []).map((id) => activityById(id, mode)).filter(Boolean) : []
  }
  function placementTestForPart(partId, mode) {
    const config = course.placementTests?.[String(partId || '')]
    return config ? clone({
      ...config,
      languageMode: languageMode(mode),
      activities: (config.activityIds || []).map((id) => activityById(id, mode)).filter(Boolean),
    }) : null
  }
  function placementTestById(testId, mode) {
    const config = Object.values(course.placementTests || {}).find((item) => String(item.id) === String(testId || ''))
    return config ? placementTestForPart(config.partId, mode) : null
  }
  function contentForNode(nodeId, mode) {
    const node = course.nodes.find((item) => String(item.id) === String(nodeId || ''))
    if (!node) return null
    const resolvedMode = languageMode(mode)
    const activities = activitiesForNode(node.id, resolvedMode)
    const type = activities[0]?.type
    return clone({
      mode: node.runMode || 'standard',
      languageMode: resolvedMode,
      nodeId: node.id,
      activityType: node.nodeType,
      challengeConfig: node.challengeConfig || null,
      activities,
      stages: type === 'deep_recall' ? ['clue', 'concept', 'reasoning']
        : type === 'multi_question_induction' ? ['questions', 'classification', 'ordering']
          : type === 'knowledge_graph' ? ['missing', 'relation', 'error'] : [],
    })
  }

  global.KGGuidedLearningData = Object.freeze({
    version: Number(course.version || 11),
    activitySchemaVersion: Number(pkg.activitySchemaVersion || 1),
    getCourse: (courseId = '') => !courseId || String(courseId) === String(course.id)
      ? { ...clone(course), nodes: clone(orderedNodes()) }
      : null,
    nodeById: (id) => clone(course.nodes.find((item) => String(item.id) === String(id || '')) || null),
    partById: (id) => clone(course.parts.find((item) => String(item.id) === String(id || '')) || null),
    stageById: (id) => clone(course.stages.find((item) => String(item.id) === String(id || '')) || null),
    activitySchemaById: (id) => clone(library[String(id || '')] || null),
    getActivityLibrary: () => clone(library),
    activityById,
    activitiesForNode,
    placementTestForPart,
    placementTestById,
    contentForNode,
    nodesForPart: (partId) => clone(orderedNodes().filter((node) => node.partId === partId)),
    nodesForStage: (stageId) => {
      const parts = new Set(course.parts.filter((part) => part.stageId === stageId).map((part) => part.id))
      return clone(orderedNodes().filter((node) => parts.has(node.partId)))
    },
    getLanguageMode: () => languageMode(),
    setLanguageMode: (mode) => schema?.setLanguageMode?.(mode) || languageMode(mode),
    validateActivity: (activity) => schema?.validate?.(activity) || { valid: true, errors: [], warnings: [] },
    validateActivityLibrary: () => schema?.validateLibrary?.(library) || { valid: true, errors: [], warnings: [] },
    exportActivityPackage: (metadata) => schema?.createPackage?.(library, metadata) || null,
  })

  global.addEventListener('message', (event) => {
    const message = event.data
    if (event.origin !== global.location.origin || message?.channel !== 'kg:new-legacy' || message.version !== 1) return
    if (message.type !== 'save:success' || !message.payload?.progress || !message.payload?.progressKey) return
    const serialized = JSON.stringify(message.payload.progress)
    if (global.KGServerStateStorage?.getItem(message.payload.progressKey) !== serialized) {
      global.KGServerStateStorage?.setItem(message.payload.progressKey, serialized)
    }
  })
})(window)
