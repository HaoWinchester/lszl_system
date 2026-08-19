#!/usr/bin/env python3
"""R0 后端/API 性能基线采集器。

默认只读取认证和 question-catalog 接口，不写入业务数据。
导入写入测量不应直接在生产环境运行；请使用隔离测试库和单独的
受控脚本/测试场景，并将其结果另存为独立 artifact。

示例：
    python backend/scripts/r0_backend_perf.py \
      --base-url http://127.0.0.1:8000 \
      --username admin --password '...' \
      --output artifacts/r0/backend-read-baseline.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


@dataclass
class Sample:
    label: str
    method: str
    path: str
    status: int | None
    ok: bool
    duration_ms: float | None
    response_bytes: int | None
    content_encoding: str | None
    error: str | None = None
    banks: int | None = None
    questions: int | None = None
    top_level_keys: list[str] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="采集 question catalog 只读基线")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="")
    parser.add_argument("--password", default="")
    parser.add_argument("--accepted-terms-version", default="2026-08-13-v1")
    parser.add_argument("--output", default="artifacts/r0/backend-read-baseline.json")
    parser.add_argument("--timeout", type=float, default=30.0)
    return parser.parse_args()


def payload_shape(payload: Any) -> tuple[int | None, int | None, list[str] | None]:
    if not isinstance(payload, dict):
        return None, None, None
    banks = payload.get("banks")
    questions = payload.get("questions")
    return (
        len(banks) if isinstance(banks, list) else None,
        len(questions) if isinstance(questions, list) else None,
        sorted(payload.keys()),
    )


def probe(client: httpx.Client, label: str, method: str, path: str) -> Sample:
    started = time.perf_counter()
    try:
        response = client.request(method, path)
        body = response.content
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        try:
            payload = response.json()
        except ValueError:
            payload = None
        banks, questions, keys = payload_shape(payload)
        return Sample(
            label=label,
            method=method,
            path=path,
            status=response.status_code,
            ok=response.is_success,
            duration_ms=duration_ms,
            response_bytes=len(body),
            content_encoding=response.headers.get("content-encoding"),
            banks=banks,
            questions=questions,
            top_level_keys=keys,
        )
    except Exception as error:  # noqa: BLE001
        return Sample(
            label=label,
            method=method,
            path=path,
            status=None,
            ok=False,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
            response_bytes=None,
            content_encoding=None,
            error=str(error),
        )


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile_value)))
    return round(ordered[index], 2)


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    samples: list[Sample] = []
    with httpx.Client(base_url=base_url, timeout=args.timeout, follow_redirects=False) as client:
        if args.username and args.password:
            started = time.perf_counter()
            try:
                response = client.post(
                    "/api/v1/auth/login",
                    json={
                        "username": args.username,
                        "password": args.password,
                        "acceptedTermsVersion": args.accepted_terms_version,
                    },
                )
                samples.append(
                    Sample(
                        label="auth-login",
                        method="POST",
                        path="/api/v1/auth/login",
                        status=response.status_code,
                        ok=response.is_success,
                        duration_ms=round((time.perf_counter() - started) * 1000, 2),
                        response_bytes=len(response.content),
                        content_encoding=response.headers.get("content-encoding"),
                    )
                )
            except Exception as error:  # noqa: BLE001
                samples.append(
                    Sample(
                        label="auth-login",
                        method="POST",
                        path="/api/v1/auth/login",
                        status=None,
                        ok=False,
                        duration_ms=round((time.perf_counter() - started) * 1000, 2),
                        response_bytes=None,
                        content_encoding=None,
                        error=str(error),
                    )
                )
        else:
            samples.append(
                Sample(
                    label="auth-login",
                    method="POST",
                    path="/api/v1/auth/login",
                    status=None,
                    ok=False,
                    duration_ms=None,
                    response_bytes=None,
                    content_encoding=None,
                    error="未提供 --username/--password，后续受保护请求可能为 401",
                )
            )

        probes = [
            ("auth-me", "/api/v1/auth/me"),
            ("catalog-managed-banks", "/api/v1/question-catalog/banks?mode=managed"),
            ("catalog-managed-summary", "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=false"),
            ("catalog-managed-full", "/api/v1/question-catalog/bootstrap?mode=managed&include_questions=true&page_size=200"),
            ("catalog-learning-summary", "/api/v1/question-catalog/bootstrap?mode=learning&include_questions=false"),
        ]
        samples.extend(probe(client, label, "GET", path) for label, path in probes)

    durations = [sample.duration_ms for sample in samples if sample.ok and sample.duration_ms is not None]
    report = {
        "schemaVersion": 1,
        "kind": "r0-backend-read-baseline",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": base_url,
        "git": {
            "activeRelease": "v9.0-p4.1.102",
            "candidate": "feat/runtime-state-to-domain-apis@9537a25",
            "sourceVersion": "v9.0-p4.1.123",
        },
        "safety": {
            "writeRequests": False,
            "note": "本报告只包含只读 API 采集；导入写入性能必须在隔离数据库中独立测量。",
        },
        "summary": {
            "sampleCount": len(samples),
            "successfulSampleCount": sum(sample.ok for sample in samples),
            "durationMs": {
                "min": round(min(durations), 2) if durations else None,
                "median": round(statistics.median(durations), 2) if durations else None,
                "p95": percentile(durations, 0.95),
                "max": round(max(durations), 2) if durations else None,
            },
            "totalResponseBytes": sum(sample.response_bytes or 0 for sample in samples),
        },
        "samples": [asdict(sample) for sample in samples],
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "sampleCount": len(samples)}, ensure_ascii=False))
    return 0 if all(sample.ok or sample.label == "auth-login" for sample in samples) else 1


if __name__ == "__main__":
    raise SystemExit(main())
