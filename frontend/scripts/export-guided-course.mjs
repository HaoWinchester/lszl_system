import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

function jsonValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.map(jsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, jsonValue(item)]))
  }
  throw new Error(`课程包不允许可执行值: ${typeof value}`)
}

function stableStringify(value) {
  return JSON.stringify(jsonValue(value))
}

function loadPublicData(upstreamRoot) {
  const storage = new Map()
  const context = {
    console: Object.freeze({ warn() {}, error() {}, log() {} }),
    Date,
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail },
    localStorage: {
      getItem: (key) => storage.get(String(key)) ?? null,
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: (key) => storage.delete(String(key)),
    },
    dispatchEvent() {},
  }
  context.window = context
  const sandbox = vm.createContext(context, { codeGeneration: { strings: false, wasm: false } })
  for (const file of ['src/86-activity-schema-v1.js', 'src/87-guided-learning-data.js']) {
    vm.runInContext(readFileSync(resolve(upstreamRoot, file), 'utf8'), sandbox, { filename: file, timeout: 2_000 })
  }
  if (!context.KGGuidedLearningData || !context.KGActivitySchemaV1) throw new Error('上游引导学习公开接口缺失')
  return { data: context.KGGuidedLearningData, schema: context.KGActivitySchemaV1 }
}

export function exportCourse(upstreamRoot) {
  const version = readFileSync(resolve(upstreamRoot, 'VERSION'), 'utf8').trim()
  const { data, schema } = loadPublicData(upstreamRoot)
  const rawCourse = data.getCourse()
  const library = data.getActivityLibrary()
  const validation = data.validateActivityLibrary()
  if (!rawCourse || !validation.valid) throw new Error(`Activity Schema 校验失败: ${JSON.stringify(validation.errors ?? [])}`)

  const activities = Object.values(library).map(jsonValue).sort((left, right) => String(left.id).localeCompare(String(right.id)))
  const { activities: _embeddedActivities, ...courseWithoutActivities } = rawCourse
  void _embeddedActivities
  const course = jsonValue({
    ...courseWithoutActivities,
    stages: [...rawCourse.stages],
    parts: [...rawCourse.parts],
    nodes: [...rawCourse.nodes],
    placementTests: Object.fromEntries(Object.entries(rawCourse.placementTests ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  })
  const validationResults = activities.map((activity) => ({ activityId: activity.id, ...jsonValue(schema.validate(activity)) }))
  const payload = {
    packageSchemaVersion: 1,
    version,
    activitySchemaVersion: Number(rawCourse.activitySchemaVersion ?? schema.SCHEMA_VERSION),
    course,
    activities,
    validation: { valid: validationResults.every((result) => result.valid), results: validationResults },
  }
  const contentHash = createHash('sha256').update(stableStringify(payload)).digest('hex')
  return jsonValue({ ...payload, contentHash: `sha256:${contentHash}` })
}

function main() {
  const frontendRoot = resolve(import.meta.dirname, '..')
  const upstreamRoot = resolve(frontendRoot, '../new-legacy')
  const output = resolve(frontendRoot, '../backend/app/seed/guided_course_v8_6_0.json')
  const payload = exportCourse(upstreamRoot)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  process.stdout.write(`已导出 ${payload.course.nodes.length} 个节点、${payload.activities.length} 个活动到 ${output}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
