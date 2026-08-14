import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_authoring_contract_and_registry_manifest_are_machine_consistent() -> None:
    contract = json.loads(
        (ROOT / "contracts" / "pmp-authoring-contract-v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    assert contract["$id"] == "pmp-authoring-contract-v1"
    assert {
        "question",
        "questionBank",
        "questionFamily",
        "principle",
        "principleBundle",
        "keyword",
        "recallBinding",
        "programCompatibility",
    } <= set(contract["$defs"])

    manifest = json.loads(
        (
            ROOT / "registries" / "pmp-authoring-registries-v1.json"
        ).read_text(encoding="utf-8")
    )
    canonical = json.dumps(
        manifest["registries"],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    assert manifest["hash"] == f"sha256:{hashlib.sha256(canonical).hexdigest()}"
