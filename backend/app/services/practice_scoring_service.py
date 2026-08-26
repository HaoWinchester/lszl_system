"""Versioned Huanpu simulation scoring defaults shared by release and practice."""

from __future__ import annotations

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


def freeze_release_metadata(metadata: dict | None) -> dict:
    """Freeze product defaults without exposing per-paper teacher overrides."""

    frozen = deepcopy(metadata) if isinstance(metadata, dict) else {}
    frozen["domainWeights"] = deepcopy(DEFAULT_DOMAIN_WEIGHTS)
    frozen["simulationScoring"] = deepcopy(DEFAULT_SIMULATION_SCORING)
    return frozen
