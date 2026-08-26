import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const sourcePath = resolve('scripts/new-legacy-assets/homepage-loader.js')

function harness() {
  const appended = []
  const events = []
  const raf = []
  const status = {
    children: [],
    classList: { add() {}, remove() {} },
    append(child) { this.children.push(child) },
    replaceChildren(...children) { this.children = children },
    set textContent(value) { this._text = value; this.children = [] },
    get textContent() { return this._text || '' },
  }
  const document = {
    readyState: 'complete',
    documentElement: { dataset: {} },
    head: {
      appendChild(node) {
        node.parentNode = this
        appended.push(node)
      },
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        dataset: {},
        addEventListener(type, listener) { this[`on${type}`] = listener },
        remove() { this.removed = true },
        setAttribute(name, value) { this[name] = value },
      }
    },
    getElementById(id) { return id === 'status' ? status : null },
    querySelector(selector) {
      if (selector === 'meta[name="kg-homepage-bundle-version"]') return { content: 'v-test' }
      return null
    },
    addEventListener() {},
  }
  const window = {
    document,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    dispatchEvent(event) { events.push(event) },
    requestAnimationFrame(callback) { raf.push(callback); return raf.length },
    setTimeout,
    clearTimeout,
  }
  window.window = window
  const context = vm.createContext({ window, document, CustomEvent: window.CustomEvent, requestAnimationFrame: window.requestAnimationFrame, setTimeout, clearTimeout, console })
  vm.runInContext(readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath })
  return { api: window.KGHomepageLoader, appended, events, raf, status, document }
}

test('graph bundle loading is coalesced, updates state, and resolves after script and style load', async () => {
  const item = harness()
  const first = item.api.loadGraph()
  const second = item.api.loadGraph()

  assert.equal(first, second)
  assert.equal(item.document.documentElement.dataset.homeGraphState, 'loading')
  assert.equal(item.appended.filter((node) => node.tagName === 'LINK').length, 1)
  assert.equal(item.appended.filter((node) => node.tagName === 'SCRIPT').length, 1)
  assert.match(item.appended.find((node) => node.tagName === 'LINK').href, /bundles\/home-graph\.css\?v=v-test/)
  assert.match(item.appended.find((node) => node.tagName === 'SCRIPT').src, /bundles\/home-graph\.js\?v=v-test/)

  item.appended.find((node) => node.tagName === 'LINK').onload()
  item.appended.find((node) => node.tagName === 'SCRIPT').onload()
  await first

  assert.equal(item.document.documentElement.dataset.homeGraphState, 'ready')
  assert.equal(item.events.at(-1).type, 'kg:homepage-group-ready')
  assert.equal(item.events.at(-1).detail.group, 'graph')
})

test('failed graph bundle can be retried without loading deferred groups', async () => {
  const item = harness()
  const failed = item.api.loadGraph()
  item.appended.find((node) => node.tagName === 'SCRIPT').onerror(new Error('network'))
  await assert.rejects(failed, /graph/i)

  assert.equal(item.document.documentElement.dataset.homeGraphState, 'error')
  assert.match(item.status.textContent, /知识图谱加载失败/)
  assert.equal(item.api.state('fileLibrary'), 'idle')
  assert.equal(item.api.state('question'), 'idle')
  assert.equal(item.api.state('secondary'), 'idle')

  const retry = item.api.loadGraph()
  assert.notEqual(retry, failed)
  assert.equal(item.appended.filter((node) => node.tagName === 'SCRIPT').length, 2)
  assert.equal(item.appended.filter((node) => node.tagName === 'LINK').length, 2)
})

test('automatic graph loading waits for the first animation frame', () => {
  const item = harness()
  assert.equal(item.appended.length, 0)
  assert.equal(item.raf.length, 1)
  item.raf[0]()
  assert.equal(item.appended.filter((node) => node.tagName === 'SCRIPT').length, 1)
})
