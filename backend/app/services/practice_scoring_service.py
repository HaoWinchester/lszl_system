"""Versioned Huanpu simulation scoring defaults shared by release and practice."""

from __future__ import annotations

import secrets
from copy import deepcopy


DEFAULT_DOMAIN_WEIGHTS = {
    "people": 42,
    "process": 50,
    "business-environment": 8,
}
DEFAULT_SIMULATION_SCORING = {
    "version": 1,
    "label": "幻谱模拟判定",
    "passPercent": 60,
    "bands": {
        "needsImprovement": 50,
        "belowTarget": 60,
        "target": 80,
    },
    "official": False,
}


def freeze_pmp_pretest_policy(
    subject: str, mode: str, refs: list[dict], selection: dict | None
) -> dict | None:
    """Pick once, before answers exist. Never derive this from a public selection seed."""
    if (
        str(subject).strip().upper() != "PMP"
        or mode not in {"practice", "challenge"}
        or len(refs) != 180
        or not isinstance(selection, dict)
        or selection.get("totalCount") != 180
    ):
        return None
    ids = [str(ref.get("questionId") or "") for ref in refs]
    if len(set(ids)) != 180 or not all(ids):
        return None
    return {"version": 1, "questionIds": secrets.SystemRandom().sample(ids, 10)}


def pretest_question_ids(scoring: dict, refs: list[dict]) -> set[str]:
    """Read a frozen policy; an absent policy means the original scoring rules."""
    if "pmpPretest" not in scoring:
        return set()
    policy = scoring["pmpPretest"]
    ids = policy.get("questionIds") if isinstance(policy, dict) else None
    available = {str(ref.get("questionId") or "") for ref in refs if isinstance(ref, dict)}
    if (
        not isinstance(policy, dict)
        or policy.get("version") != 1
        or not isinstance(ids, list)
        or len(refs) != 180
        or len(available) != 180
        or len(ids) != 10
        or any(not isinstance(qid, str) for qid in ids)
        or len(set(ids)) != 10
        or not set(ids) <= available
    ):
        raise ValueError("本次计分规则快照无效，请重试或联系管理员")
    return set(ids)


def freeze_release_metadata(metadata: dict | None) -> dict:
    """Freeze product defaults without exposing per-paper teacher overrides."""

    frozen = deepcopy(metadata) if isinstance(metadata, dict) else {}
    frozen["domainWeights"] = deepcopy(DEFAULT_DOMAIN_WEIGHTS)
    frozen["simulationScoring"] = deepcopy(DEFAULT_SIMULATION_SCORING)
    return frozen
