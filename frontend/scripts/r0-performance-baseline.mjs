#!/usr/bin/env node
/**
 * R0 性能基线采集器。
 *
 * 只读采集 API 响应体积、请求耗时和页面启动指标；不写业务数据。
 * 使用示例：
 *   R0_BASE_URL=http://127.0.0.1:8000 \
 *   R0_USERNAME=admin R0_PASSWORD='...' \
 *   node scripts/r0-performance-baseline.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { chromium, request as playwrightRequest } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(scriptDir, '..', '..')
const baseURL = (process.env.R0_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const username = process.env.R0_USERNAME || ''
const password = process.env.R0_PASSWORD || ''
const pagePath = process.env.R0_PAGE || '/question-bank'
const outputPath = resolve(repoDir, process.env.R0_OUTPUT || 'frontend/scripts/performance-baseline-before.json')
const timeoutMs = Number(process.env.R0_TIMEOUT_MS || 30_000)

function nowIso() {
  return new Date().toISOString()
}

function errorRecord(error) {
  return { error: error instanceof Error ? error.message : String(error) }
}

async function probe(request, path, label) {
  const started = performance.now()
  try {
    const response = await request.get(path, { timeout: timeoutMs })
    const body = await response.body()
    const elapsedMs = performance.now() - started
    let json = null
    try {
      json = JSON.parse(body.toString('utf8'))
    } catch {
      // 非 JSON 响应仍保留状态和体积。
    }
    const result = {
      label,
      path,
      status: response.status(),
      ok: response.ok(),
      durationMs: Number(elapsedMs.toFixed(2)),
      transferBytes: body.byteLength,
      contentLength: Number(response.headers()['content-length'] || 0) || null,
      contentEncoding: response.headers()['content-encoding'] || null,
      cacheControl: response.headers()['cache-control'] || null,
      etag: response.headers().etag || null,
    }
    if (json && typeof json === 'object') {
      result.topLevelKeys = Object.keys(json)
      for (const key of ['banks', 'questions', 'storage']) {
        if (key in json) {
          const value = json[key]
          result[`${key}Count`] = Array.isArray(value) ? value.length : null
          result[`${key}DecodedBytes`] = Buffer.byteLength(JSON.stringify(value), 'utf8')
        }
      }
      if (json.catalogRevision) result.catalogRevision = json.catalogRevision
      if (json.contentRevision != null) result.contentRevision = json.contentRevision
    }
    return result
  } catch (error) {
    return { label, path, ...errorRecord(error) }
  }
}

async function main() {
  const startedAt = nowIso()
  const browser = await chromium.launch({ headless: true })
  const request = await playwrightRequest.newContext({ baseURL })
  const api = []
  try {
    if (username && password) {
      const loginStarted = performance.now()
      const login = await request.post('/api/v1/auth/login', {
        data: { username, password, acceptedTermsVersion: process.env.R0_TERMS_VERSION || '2026-08-13-v1' },
        timeout: timeoutMs,
      })
      api.push({
        label: 'auth-login',
        path: '/api/v1/auth/login',
        status: login.status(),
        ok: login.ok(),
        durationMs: Number((performance.now() - loginStarted).toFixed(2)),
      })
      await login.body()
    } else {
      api.push({ label: 'auth-login', skipped: true, reason: 'R0_USERNAME/R0_PASSWORD 未设置' })
    }

    api.push(await probe(request, '/api/v1/auth/me', 'auth-me'))
    api.push(await probe(request, '/api/v1/question-catalog/banks?mode=managed', 'catalog-managed-banks'))
    api.push(await probe(request, '/api/v1/question-catalog/bootstrap?mode=managed&include_questions=false', 'catalog-managed-summary'))
    api.push(await probe(request, '/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true&page_size=200', 'catalog-managed-full'))
    api.push(await probe(request, '/api/v1/question-catalog/bootstrap?mode=learning&include_questions=false', 'catalog-learning-summary'))

    const storageState = await request.storageState()
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.__r0LongTasks = []
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              window.__r0LongTasks.push({
                startTime: Number(entry.startTime.toFixed(2)),
                duration: Number(entry.duration.toFixed(2)),
                name: entry.name,
              })
            }
          })
          observer.observe({ type: 'longtask', buffered: true })
        } catch {
          // 当前浏览器不支持 longtask 时保留空数组。
        }
      }
    })
    const browserRequests = []
    page.on('request', req => {
      if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
        browserRequests.push({ method: req.method(), url: req.url(), startedAt: performance.now() })
      }
    })
    const pageStarted = performance.now()
    let navigation = null
    try {
      const response = await page.goto(`${baseURL}${pagePath}`, { waitUntil: 'networkidle', timeout: timeoutMs })
      navigation = { status: response?.status() ?? null, url: page.url() }
    } catch (error) {
      navigation = errorRecord(error)
    }
    const pageMetrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource').map(entry => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        duration: Number(entry.duration.toFixed(2)),
        startTime: Number(entry.startTime.toFixed(2)),
      })).sort((a, b) => b.decodedBodySize - a.decodedBodySize)
      const navigation = performance.getEntriesByType('navigation')[0]
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map(entry => [entry.name, Number(entry.startTime.toFixed(2))]),
      )
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
      const lcp = lcpEntries.at(-1)
      const memory = performance.memory
        ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit }
        : null
      return {
        navigation: navigation
          ? {
              startTime: navigation.startTime,
              domContentLoaded: navigation.domContentLoadedEventEnd,
              loadEventEnd: navigation.loadEventEnd,
              responseStart: navigation.responseStart,
              duration: navigation.duration,
              transferSize: navigation.transferSize || 0,
              encodedBodySize: navigation.encodedBodySize || 0,
              decodedBodySize: navigation.decodedBodySize || 0,
            }
          : null,
        paints,
        lcp: lcp ? Number(lcp.startTime.toFixed(2)) : null,
        resources,
        memory,
        longTasks: window.__r0LongTasks || [],
        title: document.title,
        readyState: document.readyState,
      }
    })
    const pageElapsedMs = performance.now() - pageStarted
    await page.waitForTimeout(250)
    const longTasks = await page.evaluate(() => window.__r0LongTasks || [])
    await context.close()
    api.push({ label: 'browser-page', path: pagePath, durationMs: Number(pageElapsedMs.toFixed(2)), navigation, requestCount: browserRequests.length, requestUrls: browserRequests.map(item => ({ method: item.method, url: item.url })), pageMetrics, longTasks })
  } finally {
    await request.dispose()
    await browser.close()
  }

  const report = {
    schemaVersion: 1,
    kind: 'r0-performance-baseline',
    capturedAt: startedAt,
    baseURL,
    pagePath,
    git: {
      activeRelease: process.env.R0_ACTIVE_RELEASE || 'v9.0-p4.1.102',
      candidate: process.env.R0_CANDIDATE || 'feat/runtime-state-to-domain-apis@9537a25',
      sourceVersion: process.env.R0_SOURCE_VERSION || 'v9.0-p4.1.123',
    },
    assumptions: {
      note: '本文件只记录可复现测量；未设置凭据时，受保护接口结果为未认证响应。',
      longTaskObserver: 'Long Task 由 PerformanceObserver 采集；performance.memory 仅在 Chromium 可用时记录。',
    },
    api,
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, apiCount: api.length, capturedAt: startedAt }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
