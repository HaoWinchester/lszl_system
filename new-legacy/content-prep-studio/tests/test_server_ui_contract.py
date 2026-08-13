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
    "serverBankSelect": "选择题库后自动载入",
    "btnCreateServerBank": "新建题库",
    "btnSyncToCatalog": "同步到题库",
}
for element_id, label in required_ui.items():
    if f'id="{element_id}"' not in template or label not in template:
        raise SystemExit(f"missing server UI contract: {element_id} / {label}")

for retired_control in ("serverQuestionIdInput", "btnLoadServerQuestion", "btnLoadServerBank", "serverLoadBankSelect"):
    if retired_control in template:
        raise SystemExit(f"manual Question ID loader must not remain: {retired_control}")

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
    '"40-events-bootstrap.js"',
    '"45-server-events.js"',
]
positions = [build.find(name) for name in expected_order]
if any(position < 0 for position in positions) or positions != sorted(positions):
    raise SystemExit("server scripts are missing or ordered incorrectly")

print("server UI contracts: passed")
