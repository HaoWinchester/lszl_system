"""Resolve immutable new-legacy releases without trusting request paths."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings

VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class WebRelease:
    version: str
    site: Path
    source_hash: str


class ReleaseNotFoundError(RuntimeError):
    """Raised when no safe, built release can be resolved."""


def release_root() -> Path:
    return Path(settings.NEW_LEGACY_RELEASE_ROOT).expanduser().resolve()


def _safe_site(root: Path, relative_site: str) -> Path:
    site = (root / relative_site).resolve()
    if not site.is_relative_to(root) or not site.is_dir():
        raise ReleaseNotFoundError("new-legacy 版本目录不可用")
    return site


def active_release() -> WebRelease:
    root = release_root()
    pointer = root / "current.json"
    if pointer.is_file():
        data = json.loads(pointer.read_text(encoding="utf-8"))
        version = str(data.get("version", ""))
        if not VERSION_PATTERN.fullmatch(version):
            raise ReleaseNotFoundError("new-legacy 当前版本号无效")
        return WebRelease(
            version=version,
            site=_safe_site(root, str(data.get("site", ""))),
            source_hash=str(data.get("sourceHash", "")),
        )

    fallback = Path(settings.NEW_LEGACY_FALLBACK_SITE).expanduser().resolve()
    if fallback.is_dir():
        version_path = fallback / "VERSION"
        version = version_path.read_text(encoding="utf-8").strip() if version_path.is_file() else "fallback"
        return WebRelease(version=version, site=fallback, source_hash="")
    raise ReleaseNotFoundError("尚未导入可运行的 new-legacy 版本")


def preview_release(version: str) -> WebRelease:
    if not VERSION_PATTERN.fullmatch(version):
        raise ReleaseNotFoundError("候选版本号无效")
    root = release_root()
    manifest_path = root / version / "release.json"
    if not manifest_path.is_file():
        raise ReleaseNotFoundError(f"找不到候选版本：{version}")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return WebRelease(
        version=version,
        site=_safe_site(root, f"{version}/site"),
        source_hash=str(data.get("sourceHash", "")),
    )


def resolve_asset(release: WebRelease, relative_path: str) -> Path:
    candidate = (release.site / relative_path).resolve()
    if not candidate.is_relative_to(release.site) or not candidate.is_file():
        raise ReleaseNotFoundError("页面资源不存在")
    return candidate
