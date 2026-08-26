import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readProtectedReleaseState } from './new-legacy-release-storage.js'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const defaultRoot = resolve(frontendDir, 'new-legacy-releases')
const defaultOut = resolve(frontendDir, 'new-legacy-runtime')

function countRegularFiles(root) {
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) {
      const nested = countRegularFiles(path)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += statSync(path).size
    }
  }
  return { files, bytes }
}

function pathsOverlap(left, right) {
  const isSameOrDescendant = (parent, path) => {
    const difference = relative(parent, path)
    return difference === ''
      || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
  }
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left)
}

function resolvePhysicalPath(path) {
  let existing = resolve(path)
  const missing = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) throw new Error(`找不到路径的现有父目录：${path}`)
    missing.unshift(basename(existing))
    existing = parent
  }
  return resolve(realpathSync(existing), ...missing)
}

export function prepareRuntime({ root = defaultRoot, out = defaultOut } = {}) {
  const storageRoot = resolvePhysicalPath(root)
  const requestedOut = resolve(out)
  const runtimeOut = resolvePhysicalPath(out)
  if (pathsOverlap(storageRoot, runtimeOut)) throw new Error('输出目录不能与 release root 重叠')
  const staging = `${runtimeOut}.staging-${process.pid}`
  const state = readProtectedReleaseState(storageRoot)

  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    cpSync(resolve(storageRoot, 'current.json'), resolve(staging, 'current.json'))
    for (const version of state.protectedVersions) {
      const sourceRelease = resolve(storageRoot, version)
      const stagedRelease = resolve(staging, version)
      cpSync(resolve(sourceRelease, 'site'), resolve(stagedRelease, 'site'), { recursive: true })
      cpSync(resolve(sourceRelease, 'release.json'), resolve(stagedRelease, 'release.json'))
      cpSync(resolve(sourceRelease, 'validation.json'), resolve(stagedRelease, 'validation.json'))
    }

    const stagedState = readProtectedReleaseState(staging)
    const { files, bytes } = countRegularFiles(staging)
    rmSync(runtimeOut, { recursive: true, force: true })
    renameSync(staging, runtimeOut)
    return { versions: stagedState.protectedVersions, files, bytes, out: requestedOut }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

function parseArgs(argv) {
  let root = defaultRoot
  let out = defaultOut
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--root') {
      if (!argv[index + 1]) throw new Error('--root 缺少目录参数')
      root = argv[index + 1]
      index += 1
    } else if (value === '--out') {
      if (!argv[index + 1]) throw new Error('--out 缺少目录参数')
      out = argv[index + 1]
      index += 1
    } else {
      throw new Error(`未知参数：${value}`)
    }
  }
  return { root, out }
}

function main() {
  process.stdout.write(`${JSON.stringify(prepareRuntime(parseArgs(process.argv.slice(2))))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`[prepare-new-legacy-runtime] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
