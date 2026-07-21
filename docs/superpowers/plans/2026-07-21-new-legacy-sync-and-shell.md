# new-legacy Sync And Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `new-legacy` the reproducible generated asset source, expose the new route family through React, and establish versioned iframe navigation/auth contracts.

**Architecture:** A Node sync command validates and copies the complete upstream directory into `frontend/public/new-legacy`, writes a SHA-256 manifest/report, and injects only project-owned bridge assets into generated HTML. React remains the router and hosts each complex upstream page in a focused iframe component; the existing graph bridge is upgraded to the new source.

**Tech Stack:** Node.js built-in test runner, React 19, TypeScript 6, React Router 7, Vite 8, postMessage.

---

### Task 1: Lock the upstream sync contract

**Files:**
- Create: `frontend/scripts/new-legacy-sync.test.mjs`
- Create: `frontend/scripts/new-legacy-contract.json`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing sync contract test**

```js
test('sync copies v8.6.0 and injects project bridges without editing upstream', () => {
  const fixture = makeFixture()
  const before = hashTree(fixture.upstream)
  const result = spawnSync(process.execPath, [syncScript, '--source', fixture.upstream, '--out', fixture.output], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(hashTree(fixture.upstream), before)
  assert.equal(JSON.parse(readFileSync(resolve(fixture.output, 'manifest.json'))).version, 'v8.6.0')
  assert.match(readFileSync(resolve(fixture.output, 'learning-path.html'), 'utf8'), /new-legacy-navigation-bridge\.js/)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: FAIL because `scripts/sync-new-legacy.js` does not exist.

- [ ] **Step 3: Add the explicit baseline contract**

Create `new-legacy-contract.json` with version `v8.6.0`, the seven required iframe pages, the required guided-learning globals, and the currently acknowledged browser-storage identifiers. Add `"sync:new-legacy": "node scripts/sync-new-legacy.js"` and make `predev`/`prebuild` run it before Vite.

- [ ] **Step 4: Run the focused test**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: still FAIL only because the sync implementation is missing.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/new-legacy-sync.test.mjs frontend/scripts/new-legacy-contract.json frontend/package.json
git commit -m "test: define new-legacy sync contract"
```

### Task 2: Implement deterministic upstream synchronization

**Files:**
- Create: `frontend/scripts/sync-new-legacy.js`
- Create: `frontend/scripts/new-legacy-assets/runtime-config.override.js`
- Create: `frontend/scripts/new-legacy-assets/new-legacy-navigation-bridge.js`
- Generate: `frontend/public/new-legacy/**`
- Generate: `frontend/new-legacy-manifest.json`
- Generate: `frontend/new-legacy-sync-report.json`
- Test: `frontend/scripts/new-legacy-sync.test.mjs`

- [ ] **Step 1: Extend the failing test for missing inputs and reproducible hashes**

```js
test('sync fails closed when VERSION or a required page is missing', () => {
  const fixture = makeFixture({ omit: 'learning-path.html' })
  const result = runSync(fixture)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /learning-path\.html/)
})

test('sync is reproducible for the same source tree', () => {
  const fixture = makeFixture()
  assert.equal(runSync(fixture).status, 0)
  const first = hashTree(fixture.output)
  assert.equal(runSync(fixture).status, 0)
  assert.equal(hashTree(fixture.output), first)
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs`

Expected: FAIL on the new fail-closed and reproducibility assertions.

- [ ] **Step 3: Implement the minimal sync command**

Implement argument parsing, required-file validation, sorted recursive walking, SHA-256 hashing, clean output rebuild, bridge asset copying, HTML injection before the first upstream script, workbench derivation, manifest writing, and old/new manifest diff classification. Use `cpSync`, `rmSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, `createHash`, and `relative`; do not shell out or mutate `new-legacy`.

The generated runtime override must set:

```js
window.KG_APP_CONFIG = {
  ...(window.KG_APP_CONFIG || {}),
  auth: {
    mode: 'remote',
    baseUrl: '',
    credentials: 'include',
    allowLocalRegistration: true,
    endpoints: {
      login: '/api/v1/auth/login',
      register: '/api/v1/auth/register',
      logout: '/api/v1/auth/logout',
      session: '/api/v1/auth/me'
    }
  }
}
```

- [ ] **Step 4: Verify GREEN and generate the real assets**

Run: `cd frontend && node --test scripts/new-legacy-sync.test.mjs && pnpm sync:new-legacy`

Expected: all sync tests PASS; manifest version is `v8.6.0`; upstream tree hash is unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/sync-new-legacy.js frontend/scripts/new-legacy-assets frontend/scripts/new-legacy-sync.test.mjs frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json frontend/public/new-legacy
git commit -m "feat: add reproducible new-legacy synchronization"
```

### Task 3: Define the versioned learning-frame protocol

**Files:**
- Create: `frontend/src/iframe/newLegacyBridge.ts`
- Create: `frontend/scripts/new-legacy-bridge.test.mjs`
- Modify: `frontend/scripts/new-legacy-assets/new-legacy-navigation-bridge.js`

- [ ] **Step 1: Write failing protocol tests**

```js
test('bridge rejects wrong origins, channels, versions, and pages', () => {
  const source = readFrontend('src/iframe/newLegacyBridge.ts')
  assert.match(source, /event\.origin !== window\.location\.origin/)
  assert.match(source, /channel !== 'kg:new-legacy'/)
  assert.match(source, /version !== 1/)
  assert.match(source, /data\.page !== expectedPage/)
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/new-legacy-bridge.test.mjs`

Expected: FAIL because `newLegacyBridge.ts` does not exist.

- [ ] **Step 3: Implement typed request/response parsing**

Define `NewLegacyPage`, `NewLegacyMessage`, `parseNewLegacyMessage`, `postNewLegacyMessage`, and `newBridgeRequestId`. The parser must validate origin, channel, version, expected page, message type, and payload shape before returning a message.

- [ ] **Step 4: Implement iframe-side navigation messages**

Map `learning-path.html`, `index.html`, `question-training.html`, `question-workspace.html`, `guided-learning-node.html`, and `guided-learning-placement-test.html` to the React routes from the design spec. Capture same-origin anchor clicks, preserve `search` and `hash`, and post `{channel:'kg:new-legacy', version:1, page, type:'navigation', payload:{to}}`.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && node --test scripts/new-legacy-bridge.test.mjs`

Expected: all protocol and route-map assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/iframe/newLegacyBridge.ts frontend/scripts/new-legacy-bridge.test.mjs frontend/scripts/new-legacy-assets/new-legacy-navigation-bridge.js
git commit -m "feat: define new-legacy iframe protocol"
```

### Task 4: Add the React iframe host and route family

**Files:**
- Create: `frontend/src/routes/NewLegacyFrame.tsx`
- Create: `frontend/src/routes/LearningPath.tsx`
- Create: `frontend/src/routes/QuestionWorkspace.tsx`
- Create: `frontend/src/routes/GuidedLearningNode.tsx`
- Create: `frontend/src/routes/GuidedLearningPlacementTest.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/routes/GraphEditor.tsx`
- Create: `frontend/scripts/new-legacy-routes.test.mjs`

- [ ] **Step 1: Write the failing route contract**

```js
test('the app follows the new-legacy default route map', () => {
  const app = readFrontend('src/App.tsx')
  assert.match(app, /path="\/"[\s\S]*<LearningPath/)
  assert.match(app, /path="\/graph"[\s\S]*<GraphEditor/)
  assert.match(app, /path="\/workspace"[\s\S]*<QuestionWorkspace/)
  assert.match(app, /path="\/learning\/node"/)
  assert.match(app, /path="\/learning\/placement-test"/)
})
```

- [ ] **Step 2: Verify RED**

Run: `cd frontend && node --test scripts/new-legacy-routes.test.mjs`

Expected: FAIL because `/` still renders `GraphEditor` and the new route components are absent.

- [ ] **Step 3: Implement the generic host**

`NewLegacyFrame` accepts `{page, src}`; appends the current query string; initializes auth once without redirecting guests; listens for validated navigation/logout messages; and renders a full-viewport iframe with no border. It must remove its listener on unmount and show a retryable, domain-specific load error if the iframe fails.

- [ ] **Step 4: Implement route wrappers and switch `/`**

Each wrapper supplies one page/source pair. Keep `/users` and `/settings` behind admin `RequireAuth`; do not wrap the six upstream learning/graph routes in `RequireAuth`. Point `GraphEditor` to `/new-legacy/workbench.html?mode=free` while preserving its existing file bridge.

- [ ] **Step 5: Verify GREEN**

Run: `cd frontend && node --test scripts/new-legacy-routes.test.mjs && pnpm exec tsc -b`

Expected: route contract PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/NewLegacyFrame.tsx frontend/src/routes/LearningPath.tsx frontend/src/routes/QuestionWorkspace.tsx frontend/src/routes/GuidedLearningNode.tsx frontend/src/routes/GuidedLearningPlacementTest.tsx frontend/src/App.tsx frontend/src/routes/GraphEditor.tsx frontend/scripts/new-legacy-routes.test.mjs
git commit -m "feat: route learning pages through new-legacy host"
```

### Task 5: Verify upstream and current frontend baselines

**Files:**
- Modify: `frontend/scripts/design-contract.test.mjs`

- [ ] **Step 1: Add failing design assertions**

Assert that the generated iframe pages link the exact upstream stylesheets, the graph points to `new-legacy`, and generated pages do not load `boardmix-theme.css` or `boardmix-overrides.css` unless explicitly listed by the contract.

- [ ] **Step 2: Verify RED, make the minimal asset/host correction, and verify GREEN**

Run: `cd frontend && node --test scripts/design-contract.test.mjs`

Expected RED: at least one source/override assertion fails before the correction.

Run after correction: `cd new-legacy && node --test tests/guided-learning-v2.test.js && cd ../frontend && node --test scripts/*.test.mjs && pnpm exec tsc -b && pnpm build`

Expected GREEN: all Node tests pass; TypeScript and Vite build exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/scripts/design-contract.test.mjs frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json
git commit -m "test: verify new-legacy route and asset baseline"
```

