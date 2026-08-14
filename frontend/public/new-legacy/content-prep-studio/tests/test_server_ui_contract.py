from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
template = (ROOT / "src" / "index.template.html").read_text(encoding="utf-8")
state_domain = (ROOT / "src" / "js" / "10-state-domain.js").read_text(encoding="utf-8")
page_runtime = (ROOT / "src" / "js" / "20-page-runtime.js").read_text(encoding="utf-8")
services = (ROOT / "src" / "js" / "30-service-layer.js").read_text(encoding="utf-8")
build = (ROOT / "build.py").read_text(encoding="utf-8")

required_ui = {
    "serverActorName": "登录账号",
    "creatorFixedName": "制作人",
    "serverCatalogStatus": "服务器状态",
    "serverBankSelect": "目标题库",
    "btnCreateServerBank": "新建题库",
    "btnLoadServerQuestion": "从服务器载入",
    "btnSyncToCatalog": "确认同步到主程序",
    "sharedDraftGate": "共享草稿",
    "btnCreateSharedDraft": "新建共享草稿",
    "btnOpenSharedDrafts": "打开共享草稿列表",
}
for element_id, label in required_ui.items():
    if f'id="{element_id}"' not in template or label not in template:
        raise SystemExit(f"missing server UI contract: {element_id} / {label}")

workspace_fields = [
    "serverBankId",
    "serverBankRevision",
    "clientInstanceId",
    "lastIdempotencyKey",
    "lastBatchId",
]
question_fields = ["serverRevision", "serverContentHash", "lastSyncedAt"]
for field in workspace_fields:
    if field not in state_domain + page_runtime:
        raise SystemExit(f"missing workspace server metadata: {field}")
for field in question_fields:
    if field not in state_domain + page_runtime:
        raise SystemExit(f"missing question server metadata: {field}")

if "window.__KG_DIRECT_BOOTSTRAP__" not in state_domain:
    raise SystemExit("server actor must come from the FastAPI bootstrap payload")
if "ServerCatalogService" not in services:
    raise SystemExit("PMPPrepServices must expose ServerCatalogService")

expected_order = [
    '"00-core-bootstrap.js"',
    '"10-state-domain.js"',
    '"20-page-runtime.js"',
    '"30-service-layer.js"',
    '"35-server-catalog-service.js"',
    '"36-server-draft-service.js"',
    '"37-shared-draft-ui.js"',
    '"40-events-bootstrap.js"',
    '"45-server-events.js"',
]
positions = [build.find(name) for name in expected_order]
if any(position < 0 for position in positions) or positions != sorted(positions):
    raise SystemExit("server scripts are missing or ordered incorrectly")

if "⑦ 同步与导出" not in template:
    raise SystemExit("final sync must be presented as step seven")
if "前六步只编辑共享草稿" not in template:
    raise SystemExit("draft-only boundary before final sync is missing")

print("server UI contracts: passed")
