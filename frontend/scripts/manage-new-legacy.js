import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { CRITICAL_SITE_FILES } from './new-legacy-release-storage.js'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const defaultRoot = resolve(frontendDir, 'new-legacy-releases')
const syncScript = resolve(scriptsDir, 'sync-new-legacy.js')
const contractPath = resolve(scriptsDir, 'new-legacy-contract.json')
const homepageBundleBuilderPath = resolve(scriptsDir, 'homepage-bundles.mjs')
const homepageBundlePlanPath = resolve(scriptsDir, 'homepage-bundles.json')
const adapterRoot = resolve(scriptsDir, 'new-legacy-assets')
const uatScopeScript = resolve(repoDir, 'deploy', 'uat-change-scope.mjs')
const validationScript = process.env.KG_RELEASE_VALIDATION_SCRIPT
  ? resolve(process.env.KG_RELEASE_VALIDATION_SCRIPT)
  : resolve(scriptsDir, 'validate-new-legacy-release.sh')
const validationMaxBuffer = 64 * 1024 * 1024
const uatRemote = 'resume-prod'
const uatRemoteStatePath = '/home/ubuntu/lszl-kg-uat/.deploy-state/git-commit'

function parseArgs(argv) {
  const positional = []
  let root = defaultRoot
  let skipValidation = false
  let validationProfile = 'full'
  let uatBaseCommit = ''
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--root') {
      if (!argv[index + 1]) throw new Error('--root 缺少目录参数')
      root = resolve(argv[index + 1])
      index += 1
    } else if (value === '--skip-browser') {
      // 只供首次引导和发布管理器自身的隔离测试使用。
      skipValidation = true
    } else if (value === '--validation-profile') {
      if (!argv[index + 1]) throw new Error('--validation-profile 缺少参数')
      validationProfile = argv[index + 1]
      if (!['full', 'uat-fast'].includes(validationProfile)) {
        throw new Error(`不支持的验收级别：${validationProfile}`)
      }
      index += 1
    } else if (value === '--uat-base-commit') {
      if (!argv[index + 1]) throw new Error('--uat-base-commit 缺少参数')
      uatBaseCommit = argv[index + 1]
      index += 1
    } else {
      positional.push(value)
    }
  }
  return { command: positional[0] || 'status', argument: positional[1], root, skipValidation, validationProfile, uatBaseCommit }
}

function requireAuthorizedUatFast(baseCommit) {
  if (!baseCommit) throw new Error('uat-fast 必须提供 UAT 已部署基线')
  const deployed = spawnSync('ssh', [uatRemote, `cat ${uatRemoteStatePath} 2>/dev/null || true`], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  if (deployed.status !== 0) throw new Error('无法读取远程 UAT 部署状态')
  const deployedCommit = deployed.stdout.trim()
  if (!deployedCommit || deployedCommit !== baseCommit) {
    throw new Error(`UAT 基线 ${baseCommit} 与远端 UAT 部署状态不一致`)
  }
  const base = spawnSync('git', ['cat-file', '-e', `${baseCommit}^{commit}`], { cwd: repoDir, encoding: 'utf8' })
  if (base.status !== 0) throw new Error(`UAT 已部署基线不可用：${baseCommit}`)
  const changed = spawnSync('git', ['diff', '--name-only', baseCommit, '--'], { cwd: repoDir, encoding: 'utf8' })
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoDir, encoding: 'utf8' })
  if (changed.status !== 0 || untracked.status !== 0) throw new Error('无法核对 UAT 改动范围')
  const paths = [...new Set(`${changed.stdout}\n${untracked.stdout}`.split(/\r?\n/).filter(Boolean))]
  const classified = spawnSync(process.execPath, [uatScopeScript], {
    cwd: repoDir,
    encoding: 'utf8',
    input: `${paths.join('\n')}\n`,
  })
  if (classified.status !== 0) throw new Error(classified.stderr.trim() || '无法识别 UAT 改动范围')
  const decision = JSON.parse(classified.stdout)
  if (decision.validationProfile !== 'uat-fast') {
    throw new Error('UAT 实际改动不属于页面快速白名单，拒绝 uat-fast')
  }
  verifyDeterministicUatArtifacts(paths)
}

function verifyDeterministicUatArtifacts(paths) {
  const generatedChanged = paths.some((path) => (
    path === 'new-legacy/VERSION'
    || path === 'new-legacy/content-prep-studio/dist/content-prep.html'
    || path === 'frontend/new-legacy-manifest.json'
    || path === 'frontend/new-legacy-sync-report.json'
    || path.startsWith('frontend/public/new-legacy/')
  ))
  if (!generatedChanged) return

  const temporary = mkdtempSync(resolve(tmpdir(), 'kg-uat-fast-artifacts-'))
  try {
    const generatedSite = resolve(temporary, 'site')
    const synced = spawnSync(process.execPath, [syncScript, '--source', resolve(repoDir, 'new-legacy'), '--out', generatedSite], {
      cwd: frontendDir,
      encoding: 'utf8',
    })
    if (synced.status !== 0) throw new Error(synced.stderr.trim() || '无法复核 UAT 同步产物')
    const publicSite = resolve(frontendDir, 'public', 'new-legacy')
    if (!existsSync(publicSite) || sourceHash(generatedSite) !== sourceHash(publicSite)) {
      throw new Error('UAT 同步产物与权威源的确定性构建结果不一致')
    }
    const rootManifest = resolve(frontendDir, 'new-legacy-manifest.json')
    if (
      paths.includes('frontend/new-legacy-manifest.json')
      && readFileSync(rootManifest, 'utf8') !== readFileSync(resolve(generatedSite, 'manifest.json'), 'utf8')
    ) throw new Error('UAT 根 manifest 与确定性同步产物不一致')

    if (paths.includes('new-legacy/VERSION') || paths.includes('new-legacy/content-prep-studio/dist/content-prep.html')) {
      const generatedSource = resolve(temporary, 'new-legacy')
      mkdirSync(generatedSource, { recursive: true })
      cpSync(resolve(repoDir, 'new-legacy', 'content-prep-studio'), resolve(generatedSource, 'content-prep-studio'), { recursive: true })
      cpSync(resolve(repoDir, 'new-legacy', 'VERSION'), resolve(generatedSource, 'VERSION'))
      const rebuilt = spawnSync('python3', [resolve(generatedSource, 'content-prep-studio', 'build.py')], {
        cwd: repoDir,
        encoding: 'utf8',
      })
      if (rebuilt.status !== 0) throw new Error(rebuilt.stderr.trim() || '无法复核 content-prep 产物')
      const expected = readFileSync(resolve(generatedSource, 'content-prep-studio', 'dist', 'content-prep.html'))
      const actual = readFileSync(resolve(repoDir, 'new-legacy', 'content-prep-studio', 'dist', 'content-prep.html'))
      if (!expected.equals(actual)) throw new Error('content-prep 产物与 VERSION 的确定性构建结果不一致')
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function hashFilesystemEntry(hash, label, path) {
  hash.update(label)
  hash.update('\0')
  let stats
  try {
    stats = lstatSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    hash.update('<deleted>\0')
    return
  }
  hash.update((stats.mode & 0o7777).toString(8))
  hash.update('\0')
  if (stats.isSymbolicLink()) {
    hash.update('symlink\0')
    hash.update(readlinkSync(path))
  } else if (stats.isFile()) {
    hash.update('file\0')
    hash.update(readFileSync(path))
  } else if (stats.isDirectory()) {
    hash.update('directory')
  } else {
    hash.update('other')
  }
  hash.update('\0')
}

function validationContextHash() {
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
  if (listed.status !== 0) {
    throw new Error(listed.stderr.trim() || '无法计算 release 验收上下文')
  }
  const hash = createHash('sha256')
  for (const path of listed.stdout.split('\0').filter(Boolean).sort()) {
    hashFilesystemEntry(hash, path, resolve(repoDir, path))
  }
  hashFilesystemEntry(hash, validationScript, validationScript)
  return hash.digest('hex')
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
  for (const path of [syncScript, contractPath, homepageBundleBuilderPath, homepageBundlePlanPath]) {
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
  const missing = CRITICAL_SITE_FILES.filter((path) => !existsSync(resolve(candidateSite, path)))
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
  return { candidateFiles, activeFiles, requiredFiles: CRITICAL_SITE_FILES }
}

function writeValidationReport(root, version, report) {
  writeFileSync(resolve(root, version, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function validateCandidate(activeRoot, candidateRoot, version, skipValidation, validationProfile) {
  const startedAt = new Date().toISOString()
  const release = releaseManifest(candidateRoot, version)
  if (!release) throw new Error(`找不到候选版本：${version}`)
  const validatorHash = skipValidation ? null : validationContextHash()
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
      profile: validationProfile,
      sourceHash: release.sourceHash,
      adapterHash: release.adapterHash,
      validatorHash,
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
      profile: validationProfile,
      sourceHash: release.sourceHash,
      adapterHash: release.adapterHash,
      validatorHash,
      gate,
      error: '',
      stdout: '',
      stderr: '',
    })
  }
  const previous = readJson(resolve(candidateRoot, version, 'validation.json'))
  const compatibleProfile = previous?.profile === 'full' || previous?.profile === validationProfile
  if (
    previous?.passed === true
    && previous?.skipped !== true
    && compatibleProfile
    && previous.sourceHash === release.sourceHash
    && previous.adapterHash === release.adapterHash
    && previous.validatorHash === validatorHash
  ) return previous

  const result = spawnSync(validationScript, [candidateRoot, version, validationProfile], {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: validationMaxBuffer,
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
    profile: validationProfile,
    sourceHash: release.sourceHash,
    adapterHash: release.adapterHash,
    validatorHash,
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

function update(root, source, skipValidation = false, validationProfile = 'full') {
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
        validateCandidate(root, stagingRoot, candidate.version, skipValidation, validationProfile)
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
    validateCandidate(root, root, candidate.version, skipValidation, validationProfile)
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
  if (args.validationProfile === 'uat-fast') requireAuthorizedUatFast(args.uatBaseCommit)
  let result
  if (args.command === 'inspect') result = inspect(args.argument)
  else if (args.command === 'update') result = update(args.root, args.argument, args.skipValidation, args.validationProfile)
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
