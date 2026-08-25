# Multi-File Question Bank Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin or teacher select multiple question-bank JSON files in one action and import every contained bank through one atomic catalog API request.

**Architecture:** Extend the existing shared `QuestionBankImportController` with a `loadFiles(files)` boundary that parses each named file, rejects the whole selection on the first invalid file, and exposes one merged in-memory bank list. Keep `load(fileName, jsonText)` as a compatibility wrapper and keep `confirm()` as the single `KGQuestionCatalogAdapter.importBanks` caller so the backend transaction, replacement confirmation, duplicate cleanup confirmation, retry, and reload behavior remain authoritative.

**Tech Stack:** Vanilla JavaScript browser modules, Node `vm` contract tests, Python Playwright browser harness, FastAPI question-bank import API, managed `new-legacy` release tooling.

## Global Constraints

- A selected batch is all-or-nothing: one invalid file blocks the whole batch before the API call.
- All valid files are merged into one `POST /api/v1/banks/import` request; backend transaction behavior remains unchanged.
- Each file may contain one bank, a bank array, or `{banks: [...]}`.
- Do not persist question-bank business data in runtime state, `localStorage`, `sessionStorage`, or IndexedDB.
- Preserve source file order, bank order, question order, replacement confirmation, duplicate cleanup confirmation, retry, and single-submit behavior.
- Keep `main` unchanged until user UAT approval.

---

### Task 1: Add atomic multi-file parsing to the shared controller

**Files:**
- Modify: `new-legacy/tests/paper-management-api-contract.test.js`
- Modify: `new-legacy/src/teacher/question-bank-import-controller.js`

**Interfaces:**
- Consumes: existing `classify(payload)`, `normalizeBanks(payload)`, and `api.importBanks({banks,confirmReplace,confirmDuplicateCleanup})`.
- Produces: `loadFiles(files: Array<{name: string, text: string}>): Promise<{ok: boolean, banks?: object[], error?: string}>`; controller snapshots add `fileCount: number` and `fileNames: string[]`; existing `load(fileName, jsonText)` delegates to `loadFiles`.

- [x] **Step 1: Write failing multi-file controller tests**

Add behavior tests that call the real VM-loaded controller:

```javascript
const controller = QuestionBankImportController.create({ api })
const loaded = await controller.loadFiles([
  { name: 'a.json', text: JSON.stringify(makeBank('bank-a', ['a-1', 'a-2'])) },
  { name: 'b.json', text: JSON.stringify({ banks: [makeBank('bank-b', ['b-1'])] }) },
])
assert.equal(loaded.ok, true)
assert.deepEqual(controller.snapshot().fileNames, ['a.json', 'b.json'])
assert.equal(controller.snapshot().fileCount, 2)
assert.deepEqual(controller.snapshot().banks.map(bank => bank.id), ['bank-a', 'bank-b'])
await controller.confirm()
assert.deepEqual(requests[0].banks.flatMap(bank => bank.questions.map(question => question.id)), ['a-1', 'a-2', 'b-1'])
assert.equal(requests.length, 1)
```

Add a separate test where `bad.json` contains malformed JSON. Assert `loaded.ok === false`, the error begins with `bad.json：`, `snapshot().banks` is empty, and `api.importBanks` is never called. Add the same whole-batch assertion for a paper package mixed with a valid bank.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node new-legacy/tests/paper-management-api-contract.test.js
```

Expected: FAIL because `controller.loadFiles` does not exist.

- [x] **Step 3: Implement the minimal controller behavior**

Implement a named-file parser and atomic batch load:

```javascript
function parseFile(file){
  const name=String(file?.name||'question-bank.json');
  let payload;
  try{payload=JSON.parse(String(file?.text||'').replace(/^\ufeff/,''))}
  catch(error){throw new Error(`${name}：JSON 解析失败：${error?.message||error}`)}
  const kind=classify(payload);
  if(kind==='paper-package')throw new Error(`${name}：检测到试卷包 JSON，请使用“导入试卷”。`);
  if(kind!=='question-bank')throw new Error(`${name}：不支持的题库 JSON：需要单个题库、题库数组或包含 banks 数组的数据包。`);
  return {name,payload,banks:normalizeBanks(payload)};
}
async function loadFiles(files){
  const entries=Array.from(files||[]);
  if(!entries.length){resetState();return fail('请至少选择一个题库 JSON 文件。')}
  try{
    const parsed=entries.map(parseFile);
    const banks=parsed.flatMap(item=>item.banks);
    state={fileName:parsed.map(item=>item.name).join('、'),fileNames:parsed.map(item=>item.name),fileCount:parsed.length,packageData:parsed.map(item=>item.payload),banks,bankCount:banks.length,questionCount:banks.reduce((sum,bank)=>sum+bank.questions.length,0),busy:false,error:'',success:null};
    emit();
    return {ok:true,banks:clone(banks)};
  }catch(error){resetParsedState(entries.map(item=>String(item?.name||'')));return fail(error.message)}
}
```

Initialize and reset `fileNames`/`fileCount` in every state path. Implement `load(fileName,jsonText)` as `return loadFiles([{name:fileName,text:jsonText}])` and expose `loadFiles` in the frozen controller API.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node new-legacy/tests/paper-management-api-contract.test.js
node new-legacy/tests/content-prep-question-bank-integration.test.js
node new-legacy/tests/question-import-persistence.test.js
```

Expected: all pass; the single-file compatibility path remains green.

- [x] **Step 5: Commit the controller slice**

```bash
git add new-legacy/src/teacher/question-bank-import-controller.js new-legacy/tests/paper-management-api-contract.test.js
git commit -m "feat: parse multiple question bank files atomically"
```

### Task 2: Bind multi-file selection and visible recovery behavior

**Files:**
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/src/65-question-bank-admin.js`
- Modify: `new-legacy/tests/v90-p35-paper-management.test.js`
- Modify: `new-legacy/tests/v90-p35-paper-management-browser.py`

**Interfaces:**
- Consumes: `QuestionBankImportController.loadFiles(files)` and snapshot fields `fileCount`, `fileNames`, `bankCount`, `questionCount`, `banks`, `busy`, `error`, and `success`.
- Produces: `#qbBankImportFile[multiple]`, multi-file summary text, and one batch submission through the existing confirm button.

- [x] **Step 1: Write failing static and browser tests**

In the static test, require:

```javascript
assert.match(html, /id="qbBankImportFile"[^>]*multiple/)
assert.match(html, /选择一个或多个题库 JSON 文件/)
```

In the browser harness, set two generated bank files on `#qbBankImportFile`, then assert the visible result includes `2 个文件`, the literal summed bank/question counts, both filenames, and an enabled confirm button. Intercept `/api/v1/banks/import` and assert one request carries both banks in selection order. Add a second case with one malformed file and assert a filename-qualified error, disabled confirm, zero import requests, then replace the selection with two valid files and assert recovery.

- [x] **Step 2: Run the focused UI tests and verify RED**

Run:

```bash
node new-legacy/tests/v90-p35-paper-management.test.js
python3 new-legacy/tests/v90-p35-paper-management-browser.py
```

Expected: static test fails because `multiple` and the new label are absent; browser test fails because only `files[0]` is read.

- [x] **Step 3: Implement the multi-file UI binding**

Change the input to:

```html
<label class="qb-field"><span>选择一个或多个题库 JSON 文件</span><input id="qbBankImportFile" type="file" accept="application/json,.json" multiple /></label>
```

Replace the single file reference with a transient array and read all files:

```javascript
let questionBankImportController=null,questionBankImportFiles=[];
$('qbBankImportFile')?.addEventListener('change',async event=>{
  questionBankImportFiles=Array.from(event.currentTarget.files||[]);
  if(!questionBankImportFiles.length)return questionBankImportController.cancel();
  const files=await Promise.all(questionBankImportFiles.map(async file=>({name:file.name,text:await file.text()})));
  await questionBankImportController.loadFiles(files);
});
```

Render the summary as `已选择 N 个文件：...` and add a `N 个文件` badge before the existing bank/question badges. Reset the array on open and cancel. Do not add durable browser storage.

- [x] **Step 4: Run UI and integration tests and verify GREEN**

Run:

```bash
node new-legacy/tests/v90-p35-paper-management.test.js
python3 new-legacy/tests/v90-p35-paper-management-browser.py
node new-legacy/tests/paper-management-api-contract.test.js
```

Expected: all pass, including success, invalid-batch, recovery, retry, and one-request assertions.

- [x] **Step 5: Sync authoritative generated output and rerun generated contracts**

Run:

```bash
cd frontend
pnpm sync:new-legacy
node --test scripts/online-qa-regressions.test.mjs
```

Expected: generated HTML and JavaScript contain the multi-file behavior and the regression contract passes.

- [x] **Step 6: Commit the UI slice**

```bash
git add new-legacy frontend/public/new-legacy frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json backend/app/seed/guided_course_v8_6_0.json
git commit -m "feat: import multiple question bank files"
```

### Task 3: Publish and verify the UAT release

**Files:**
- Modify: `new-legacy/VERSION`
- Modify: `new-legacy/content-prep-studio/dist/content-prep.html`
- Modify: generated release files under `frontend/public/new-legacy/`
- Modify: `docs/superpowers/plans/2026-08-24-multi-file-question-bank-import.md`

**Interfaces:**
- Consumes: managed release command and the local FastAPI server at `http://127.0.0.1:8000`.
- Produces: a new active local release, updated feature branch, and updated `uat`; `main` remains unchanged.

- [x] **Step 1: Run source persistence scans and focused backend tests**

Run:

```bash
rg -n "localStorage|sessionStorage|indexedDB|runtime/state" new-legacy/src/teacher/question-bank-import-controller.js
cd backend
.venv/bin/python -m pytest tests/test_question_api_compatibility.py -q
```

Expected: no persistence hits in the controller and all focused backend tests pass.

- [x] **Step 2: Run the complete frontend suite**

Run:

```bash
cd frontend
node --test --test-reporter=spec scripts/*.test.mjs
pnpm test:design
```

Expected: all tests pass with no new warning.

- [x] **Step 3: Build and promote a managed release**

Increase `new-legacy/VERSION` by one patch release, run `python3 new-legacy/content-prep-studio/build.py`, then `cd frontend && pnpm sync:new-legacy`. Compare current active and candidate file counts and require both critical pages plus `src/teacher/question-bank-import-controller.js`. Promote only with:

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

Expected: active/public counts match, critical files exist, and active/public critical-file hashes match.

- [x] **Step 4: Perform a local browser curious-user pass**

As `admin`, open `/paper-management.html`; choose at least two generated valid files and confirm the UI reports exact counts and one request. Then choose a valid file plus malformed file and verify the whole batch blocks without an API call; replace with valid files and verify recovery. Do not submit the user's untracked real sample files to the database.

- [x] **Step 5: Commit, push feature/UAT only, and verify refs**

Commit release artifacts, push `codex/paper-draft-api-import-composition` through `http://127.0.0.1:7897`, merge it into `uat`, push `uat` through the same proxy, and verify remote refs. Assert local and remote `main` remain `ccb51e3688eb265985420d0e887b47d769fc775e`.

Expected: feature and UAT point to the tested work, the local server remains available for user testing, and no merge or push targets `main`.
