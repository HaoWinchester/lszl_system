import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const RUNTIME_LIMIT_BYTES = 50 * 1024 * 1024
export const CRITICAL_SITE_FILES = [
  'landing.html',
  'styles/landing.css',
  'src/landing.js',
  'assets/landing/graph.png',
  'admin-console.html',
  'question-bank.html',
  'content-prep-studio/dist/content-prep.html',
]

const HASH_PATTERN = /^[a-f0-9]{64}$/

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readJson(path, label) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} 无法读取：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(value)) throw new Error(`${label} 必须是对象`)
  return value
}

function assertSafeVersion(version, label) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`${label} 不合法：${String(version)}`)
  }
}

function relativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

export function inventoryTree(root) {
  const treeRoot = resolve(root)
  const hash = createHash('sha256')
  const files = []
  let bytes = 0

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`库存目录包含符号链接：${relativePath(treeRoot, path)}`)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      files.push({ path: relativePath(treeRoot, path), absolutePath: path })
    }
  }

  visit(treeRoot)
  files.sort((left, right) => left.path.localeCompare(right.path))
  for (const file of files) {
    bytes += statSync(file.absolutePath).size
    hash.update(file.path)
    hash.update('\0')
    hash.update(readFileSync(file.absolutePath))
    hash.update('\0')
  }
  return { files: files.length, bytes, hash: hash.digest('hex'), paths: files.map((file) => file.path) }
}

function readProtectedRelease(root, version, role) {
  const releaseDir = resolve(root, version)
  if (!existsSync(releaseDir) || !statSync(releaseDir).isDirectory()) {
    throw new Error(`${role}不存在：${version}`)
  }

  const release = readJson(resolve(releaseDir, 'release.json'), `${role} release.json`)
  if (release.version !== version) throw new Error(`${role} release.json 版本不匹配：${version}`)
  if (typeof release.sourceHash !== 'string' || !HASH_PATTERN.test(release.sourceHash)) {
    throw new Error(`${role} sourceHash 不合法：${version}`)
  }
  if (typeof release.adapterHash !== 'string' || !HASH_PATTERN.test(release.adapterHash)) {
    throw new Error(`${role} adapterHash 不合法：${version}`)
  }

  const validation = readJson(resolve(releaseDir, 'validation.json'), `${role} validation.json`)
  if (validation.passed !== true) throw new Error(`${role} 未通过验收：${version}`)

  const site = resolve(releaseDir, 'site')
  if (!existsSync(site) || !statSync(site).isDirectory()) throw new Error(`${role} site 目录不存在：${version}`)
  for (const file of CRITICAL_SITE_FILES) {
    const path = resolve(site, file)
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${role} site 缺少关键文件：${file}`)
  }
  return release
}

export function readProtectedReleaseState(root) {
  const storageRoot = resolve(root)
  const pointerPath = resolve(storageRoot, 'current.json')
  let pointerBytes
  try {
    pointerBytes = readFileSync(pointerPath)
  } catch (error) {
    throw new Error(`current.json 无法读取：${error instanceof Error ? error.message : String(error)}`)
  }

  let pointer
  try {
    pointer = JSON.parse(pointerBytes.toString('utf8'))
  } catch (error) {
    throw new Error(`current.json 无法解析：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(pointer)) throw new Error('current.json 必须是对象')
  if (pointer.schemaVersion !== 1) throw new Error('current.json schemaVersion 必须为 1')
  assertSafeVersion(pointer.version, 'current.json version')
  if (pointer.site !== `${pointer.version}/site`) throw new Error('current.json site 与 active 版本不匹配')
  if (pointer.previousVersion !== null && pointer.previousVersion !== undefined) {
    assertSafeVersion(pointer.previousVersion, 'current.json previousVersion')
    if (pointer.previousVersion === pointer.version) throw new Error('current.json previousVersion 不能与 active 版本相同')
  }
  if (pointer.previousVersion === undefined) throw new Error('current.json previousVersion 必须为 null 或安全版本号')

  const protectedVersions = [pointer.version]
  if (pointer.previousVersion !== null) protectedVersions.push(pointer.previousVersion)
  const releases = new Map()
  for (const [index, version] of protectedVersions.entries()) {
    releases.set(version, readProtectedRelease(storageRoot, version, index === 0 ? '当前版本' : '回滚版本'))
  }
  return {
    pointer,
    pointerHash: createHash('sha256').update(pointerBytes).digest('hex'),
    protectedVersions,
    releases,
  }
}
