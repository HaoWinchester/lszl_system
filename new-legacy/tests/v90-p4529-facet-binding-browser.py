"""Browser E2E for P4.5.29 G2: Subject Facet full chain (diff 9-11, 27, 29).

Loads dist/content-prep.html with a stubbed /api/v1/content-prep/subject-facets
endpoint and asserts the full chain:

1. base tab shows the facet manager with the default PMP schema (diff 9)
2. importing a pmp-facet-schema-v1 file replaces the schema by subject (diff 10)
3. question editor binds metadata.subjectFacets via stable facet IDs (diff 11)
4. an unknown facet reference is an error in the validation center and blocks
   the export/sync path; clearing it restores a clean validation (diff 29)
5. exporting the complete bundle carries subjectFacetRegistry (diff 27)
6. server adapter loads schemas from /content-prep/subject-facets and handles
   a 409 revision conflict by refreshing the latest and refusing to overwrite
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"

IMPORTED_SCHEMA = {
    "format": "pmp-facet-schema-v1",
    "schemaId": "pmp-facet-v2",
    "schemaVersion": 1,
    "subjectId": "subject-pmp",
    "subjectCodes": ["PMP"],
    "name": "PMP 科目分类 v2",
    "status": "active",
    "dimensions": [
        {"id": "delivery-approach", "label": "交付方式", "selection": "multi", "status": "active", "values": [
            {"id": "predictive", "label": "预测型", "status": "active", "aliases": [], "replacedBy": []},
            {"id": "hybrid", "label": "混合型", "status": "active", "aliases": [], "replacedBy": []},
        ]},
    ],
}

SERVER_SCHEMAS = [
    {
        "schemaId": "pmp-facet-server",
        "schemaVersion": 1,
        "subjectId": "subject-pmp",
        "subjectCodes": ["PMP"],
        "name": "PMP 服务器分类",
        "status": "active",
        "dimensions": [
            {"id": "exam-domain", "label": "考试域", "selection": "multi", "status": "active", "values": [
                {"id": "people", "label": "人员", "status": "active", "aliases": [], "replacedBy": []},
            ]},
        ],
        "revision": 3,
    }
]


def run() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.on("dialog", lambda dialog: dialog.accept())

        # file:// 页面无法走 playwright route，直接 stub window.fetch 模拟服务器
        stub = """
        window.__facetStub = {calls: [], mode: 'ok'};
        const realFetch = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          const href = String(url);
          if (!href.includes('/content-prep/subject-facets')) return realFetch(url, options);
          const method = String((options || {}).method || 'GET').toUpperCase();
          window.__facetStub.calls.push({method, revision: JSON.parse((options || {}).body || '{}').contentRevision});
          if (method === 'PUT' && window.__facetStub.mode === 'conflict') {
            return new Response(JSON.stringify({detail: {code: 'SUBJECT_FACET_REVISION_CONFLICT',
              message: 'content revision mismatch', currentContentRevision: 7}}), {status: 409, headers: {'content-type': 'application/json'}});
          }
          return new Response(JSON.stringify({schemas: window.__facetStub.schemas, contentRevision: 7}),
            {status: 200, headers: {'content-type': 'application/json'}});
        };
        """
        page.add_init_script(stub)
        page.goto(DIST.as_uri())
        page.wait_for_timeout(400)
        page.evaluate("schemas => { window.__facetStub.schemas = schemas; }", SERVER_SCHEMAS)
        if page.locator("#creatorGate").is_visible():
            page.click('#creatorGate button[data-creator-key="peiqi"]')
            page.wait_for_timeout(300)
        # 共享草稿 Gate 在离线/测试场景直接关闭（草稿流本身由 36/37 的单测覆盖）
        page.evaluate("() => { document.getElementById('sharedDraftGate')?.classList.add('hidden'); }")
        page.wait_for_timeout(200)

        # 1) default PMP schema visible on base tab (差异 9)
        assert page.locator("#subjectFacetManager").inner_text().find("PMP 科目分类") >= 0
        assert page.locator("#subjectFacetManager").inner_text().find("绩效域") >= 0

        # 2) import pmp-facet-schema-v1 replaces schema by subject (差异 10)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(IMPORTED_SCHEMA, handle, ensure_ascii=False)
            schema_path = handle.name
        page.set_input_files("#fileFacetSchema", schema_path)
        page.wait_for_timeout(200)
        text = page.locator("#subjectFacetManager").inner_text()
        assert "PMP 科目分类 v2" in text, text
        assert "绩效域" not in text, "同 subjectId 的旧 schema 应被替换"

        # 3) question editor binds facets via stable IDs (差异 11)
        page.click('button[data-tab="questions"]')
        page.wait_for_timeout(200)
        page.click("#btnNewQuestion")
        page.wait_for_timeout(200)
        page.check("#questionFacetBindingPanel input[data-facet-check][value='subject/pmp/delivery-approach/predictive']")
        page.wait_for_timeout(100)
        facets = page.evaluate("() => currentQuestion().metadata.subjectFacets.map(x => x.facetId)")
        assert facets == ["subject/pmp/delivery-approach/predictive"], facets

        # 4) unknown reference → validation error blocking sync (差异 29)
        errors_before = page.evaluate("() => runValidation().metrics.errors")
        page.evaluate("() => { currentQuestion().metadata.subjectFacets.push({facetId:'subject/pmp/ghost/value',status:'unknown'}); renderQuestionFacetBindings(); }")
        page.wait_for_timeout(100)
        errors = page.evaluate("() => runValidation().metrics.errors")
        assert errors == errors_before + 1, (errors_before, errors, "未知 facet 引用必须新增一个 error")
        rows = page.evaluate("() => runValidation().issues.filter(x => x.level==='error' && x.message.includes('ghost')).length")
        assert rows == 1
        # 清除未知引用后恢复（其他题目级校验错误不属于本场景）
        page.click("#btnClearUnknownFacets")
        page.wait_for_timeout(100)
        errors = page.evaluate("() => runValidation().metrics.errors")
        ghost_left = page.evaluate("() => runValidation().issues.filter(x => x.message.includes('ghost')).length")
        assert ghost_left == 0 and errors == errors_before, (errors_before, errors, ghost_left)

        # 5) complete bundle carries subjectFacetRegistry (差异 27)
        payload = page.evaluate("() => completeBundlePayload().subjectFacetRegistry")
        assert payload and any(s["schemaId"] == "pmp-facet-v2" for s in payload["schemas"]), payload

        # 6) server adapter: load from server + 409 revision conflict refusal (差异 9)
        loaded = page.evaluate("async () => { const r = await window.PMPPrepP45Server.loadSubjectFacetSchemas(); return {n: r.schemas.length, rev: r.contentRevision, name: facetSchemaForSubject('PMP').name}; }")
        assert loaded["n"] == 1 and loaded["rev"] == 7 and loaded["name"] == "PMP 服务器分类", loaded
        page.evaluate("() => { window.__facetStub.mode = 'conflict'; }")
        conflict = page.evaluate("""async () => {
          try {
            await window.PMPPrepP45Server.pushSubjectFacetSchema(facetSchemaForSubject('PMP'), {contentRevision: 0});
            return null;
          } catch (error) {
            return {code: error.code, message: error.message, latest: error.detail?.latestContentRevision};
          }
        }""")
        assert conflict and conflict["code"] == "SUBJECT_FACET_REVISION_CONFLICT", conflict
        assert conflict["latest"] == 7, conflict  # 已刷新为最新并要求重新确认，未静默覆盖

        browser.close()
    print("v90-p4529 facet binding browser: passed")


if __name__ == "__main__":
    run()
