import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const defaultRoot = resolve(frontendDir, 'new-legacy-releases')
const syncScript = resolve(scriptsDir, 'sync-new-legacy.js')
const contractPath = resolve(scriptsDir, 'new-legacy-contract.json')
const adapterRoot = resolve(scriptsDir, 'new-legacy-assets')
const validationScript = process.env.KG_RELEASE_VALIDATION_SCRIPT
  ? resolve(process.env.KG_RELEASE_VALIDATION_SCRIPT)
  : resolve(scriptsDir, 'validate-new-legacy-release.sh')
const criticalSiteFiles = [
  'landing.html',
  'styles/landing.css',
  'src/landing.js',
  'assets/landing/graph.png',
  'admin-console.html',
  'question-bank.html',
  'content-prep-studio/dist/content-prep.html',
]

function parseArgs(argv) {
  const positional = []
  let root = defaultRoot
  let skipValidation = false
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--root') {
      if (!argv[index + 1]) throw new Error('--root 缺少目录参数')
      root = resolve(argv[index + 1])
      index += 1
    } else if (value === '--skip-browser') {
      // 只供首次引导和发布管理器自身的隔离测试使用。
      skipValidation = true
    } else {
      positional.push(value)
    }
  }
  return { command: positional[0] || 'status', argument: positional[1], root, skipValidation }
}

function walk(root, base = root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name)
      return entry.isDirectory() ? walk(path, base) : [relative(base, path)]
    })
    .sort()
}

function sourceHash(source) {
  const hash = createHash('sha256')
  for (const path of walk(source)) {
    hash.update(path)
    hash.update('\0')
    hash.update(readFileSync(resolve(source, path)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function adapterHash() {
  const hash = createHash('sha256')
  for (const path of [syncScript, contractPath]) {
    hash.update(relative(frontendDir, path))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  for (const path of walk(adapterRoot)) {
    hash.update(`new-legacy-assets/${path}`)
    hash.update('\0')
    hash.update(readFileSync(resolve(adapterRoot, path)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, path)
}

function releaseManifest(root, version) {
  return readJson(resolve(root, version, 'release.json'))
}

function currentManifest(root) {
  return readJson(resolve(root, 'current.json'))
}

function pointerFor(release, previousVersion) {
  return {
    schemaVersion: 1,
    version: release.version,
    previousVersion,
    site: `${release.version}/site`,
    sourceHash: release.sourceHash,
    adapterHash: release.adapterHash,
    promotedAt: new Date().toISOString(),
  }
}

function promote(root, version) {
  const release = releaseManifest(root, version)
  if (!release) throw new Error(`找不到已构建版本：${version}`)
  const current = currentManifest(root)
  if (
    current?.version === version
    && current.sourceHash === release.sourceHash
    && current.adapterHash === release.adapterHash
  ) return current
  const previousVersion = current?.version === version
    ? current.previousVersion ?? null
    : current?.version ?? null
  const pointer = pointerFor(release, previousVersion)
  atomicJson(resolve(root, 'current.json'), pointer)
  return pointer
}

function withLock(root, operation) {
  mkdirSync(root, { recursive: true })
  const lockPath = resolve(root, '.update.lock')
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx')
  } catch {
    throw new Error('已有 new-legacy 更新正在执行')
  }
  try {
    return operation()
  } finally {
    closeSync(descriptor)
    rmSync(lockPath, { force: true })
  }
}

function inspect(source) {
  const normalized = resolve(source || '')
  if (!source || !existsSync(normalized) || !statSync(normalized).isDirectory()) {
    throw new Error(`找不到 new-legacy 目录：${normalized}`)
  }
  const versionPath = resolve(normalized, 'VERSION')
  if (!existsSync(versionPath)) throw new Error('new-legacy 缺少 VERSION')
  const version = readFileSync(versionPath, 'utf8').trim()
  if (!version) throw new Error('new-legacy/VERSION 不能为空')
  return {
    source: normalized,
    version,
    sourceHash: sourceHash(normalized),
    adapterHash: adapterHash(),
    files: walk(normalized).length,
  }
}

function candidateSiteGate(activeRoot, candidateRoot, version) {
  const candidateSite = resolve(candidateRoot, version, 'site')
  if (!existsSync(candidateSite) || !statSync(candidateSite).isDirectory()) {
    throw new Error('候选 site 目录不存在')
  }
  const missing = criticalSiteFiles.filter((path) => !existsSync(resolve(candidateSite, path)))
  if (missing.length) throw new Error(`候选 site 缺少关键文件：${missing.join(', ')}`)
  const candidateFiles = walk(candidateSite).length
  const current = currentManifest(activeRoot)
  let activeFiles = 0
  if (current?.site) {
    const activeSite = resolve(activeRoot, current.site)
    if (!existsSync(activeSite) || !statSync(activeSite).isDirectory()) {
      throw new Error(`当前 active site 不可用：${current.site}`)
    }
    activeFiles = walk(activeSite).length
    if (candidateFiles < activeFiles) {
      throw new Error(`候选 site 文件数 ${candidateFiles} 少于当前 active site ${activeFiles}`)
    }
  }
  return { candidateFiles, activeFiles, requiredFiles: criticalSiteFiles }
}

function writeValidationReport(root, version, report) {
  writeFileSync(resolve(root, version, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function validateCandidate(activeRoot, candidateRoot, version, skipValidation) {
  const startedAt = new Date().toISOString()
  let gate
  try {
    gate = candidateSiteGate(activeRoot, candidateRoot, version)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeValidationReport(candidateRoot, version, {
      schemaVersion: 1,
      version,
      passed: false,
      startedAt,
      completedAt: new Date().toISOString(),
      command: ['candidate-site-gate'],
      error: message,
      stdout: '',
      stderr: message,
    })
    throw new Error(`候选版本 ${version} 自动验收失败，正式版本未切换：\n${message}`)
  }
  if (skipValidation) {
    return writeValidationReport(candidateRoot, version, {
      schemaVersion: 1,
      version,
      passed: true,
      skipped: true,
      startedAt,
      completedAt: new Date().toISOString(),
      command: ['candidate-site-gate'],
      gate,
      error: '',
      stdout: '',
      stderr: '',
    })
  }
  const result = spawnSync(validationScript, [candidateRoot, version], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  const error = result.status === 0
    ? ''
    : String(result.stderr || result.error?.message || result.stdout || `退出码 ${result.status}`).trim()
  const report = {
    schemaVersion: 1,
    version,
    passed: result.status === 0,
    startedAt,
    completedAt: new Date().toISOString(),
    command: [validationScript, candidateRoot, version],
    gate,
    error,
    stdout: String(result.stdout || '').slice(-40_000),
    stderr: String(result.stderr || result.error?.message || '').slice(-40_000),
  }
  writeValidationReport(candidateRoot, version, report)
  if (result.status !== 0) {
    const detail = report.stderr.trim() || report.stdout.trim() || `退出码 ${result.status}`
    throw new Error(`候选版本 ${version} 自动验收失败，正式版本未切换：\n${detail}`)
  }
  return report
}

function buildRelease(releaseDir, candidate) {
  mkdirSync(releaseDir, { recursive: true })
  const sourceOut = resolve(releaseDir, 'source')
  const siteOut = resolve(releaseDir, 'site')
  cpSync(candidate.source, sourceOut, { recursive: true })
  const built = spawnSync(process.execPath, [syncScript, '--source', sourceOut, '--out', siteOut], {
    cwd: frontendDir,
    encoding: 'utf8',
  })
  if (built.status !== 0) throw new Error(built.stderr.trim() || 'new-legacy 构建失败')
  const release = {
    schemaVersion: 1,
    version: candidate.version,
    sourceHash: candidate.sourceHash,
    sourceFiles: candidate.files,
    adapterVersion: 4,
    adapterHash: candidate.adapterHash,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(resolve(releaseDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
  return release
}

function update(root, source, skipValidation = false) {
  return withLock(root, () => {
    const candidate = inspect(source)
    const finalDir = resolve(root, candidate.version)
    const existing = releaseManifest(root, candidate.version)
    if (existing && existing.sourceHash !== candidate.sourceHash) {
      throw new Error(`相同版本号 ${candidate.version} 的文件内容不同，拒绝覆盖`)
    }
    if (!existing) {
      const staging = resolve(root, `.staging-${candidate.version}-${process.pid}`)
      rmSync(staging, { recursive: true, force: true })
      mkdirSync(staging, { recursive: true })
      try {
        buildRelease(staging, candidate)
        renameSync(staging, finalDir)
      } catch (error) {
        rmSync(staging, { recursive: true, force: true })
        throw error
      }
    } else if (existing.adapterHash !== candidate.adapterHash) {
      const stagingRoot = resolve(root, `.adapter-staging-${candidate.version}-${process.pid}`)
      const stagingRelease = resolve(stagingRoot, candidate.version)
      const backup = resolve(root, `.adapter-backup-${candidate.version}-${existing.adapterHash}`)
      rmSync(stagingRoot, { recursive: true, force: true })
      rmSync(backup, { recursive: true, force: true })
      try {
        buildRelease(stagingRelease, candidate)
        validateCandidate(root, stagingRoot, candidate.version, skipValidation)
        renameSync(finalDir, backup)
        try {
          renameSync(stagingRelease, finalDir)
          const pointer = promote(root, candidate.version)
          rmSync(backup, { recursive: true, force: true })
          return pointer
        } catch (error) {
          rmSync(finalDir, { recursive: true, force: true })
          renameSync(backup, finalDir)
          throw error
        }
      } finally {
        rmSync(stagingRoot, { recursive: true, force: true })
      }
    }
    validateCandidate(root, root, candidate.version, skipValidation)
    return promote(root, candidate.version)
  })
}

function rollback(root) {
  return withLock(root, () => {
    const current = currentManifest(root)
    if (!current?.previousVersion) throw new Error('没有可回滚的成功版本')
    const previous = releaseManifest(root, current.previousVersion)
    if (!previous) throw new Error(`回滚版本不存在：${current.previousVersion}`)
    const pointer = pointerFor(previous, current.version)
    atomicJson(resolve(root, 'current.json'), pointer)
    return pointer
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  let result
  if (args.command === 'inspect') result = inspect(args.argument)
  else if (args.command === 'update') result = update(args.root, args.argument, args.skipValidation)
  else if (args.command === 'promote') result = withLock(args.root, () => promote(args.root, args.argument))
  else if (args.command === 'rollback') result = rollback(args.root)
  else if (args.command === 'status') result = currentManifest(args.root) || { status: 'empty' }
  else throw new Error(`未知命令：${args.command}`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`[manage-new-legacy] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
