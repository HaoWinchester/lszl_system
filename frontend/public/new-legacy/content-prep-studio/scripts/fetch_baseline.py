#!/usr/bin/env python3
"""从远程服务器拉取 Prep Studio 固定基准数据(知识树/联想库/八大原则/归纳卡/标签配置)。

产物:
  baseline/baseline.json            —— build.py 注入单 HTML 的基线快照
  baseline/baseline-id-cheatsheet.md —— 给大模型做「文档→题目 JSON」转换时的基线 ID 速查表

用法:
  python3 scripts/fetch_baseline.py \
      [--base-url https://lszl.aihuanpu.com] \
      [--username admin] [--password admin123] [--subject PMP]

账号密码也可用环境变量 PREP_BASELINE_USER / PREP_BASELINE_PASS 提供。
只做只读拉取(login + GET shared-content),不写任何服务器数据。
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path

try:  # macOS Framework Python 常缺系统 CA 链,优先用 certifi
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    SSL_CONTEXT = None

# 与 backend/app/api/v1/auth.py 的 LEGAL_CONSENT_VERSION 保持一致;登录被 400 拒绝时优先核对此处。
LEGAL_CONSENT_VERSION = "2026-08-13-v1"

# baseline 只保留这五部分;subjectFacetSchemas 由登录后的 server 流程单独拉取,不进基线。
BASELINE_KEYS = ("knowledgeTree", "recallLibrary", "principles", "synthesisPresets", "tagConfig")

SCRIPT_DIR = Path(__file__).resolve().parent
STUDIO_ROOT = SCRIPT_DIR.parent
BASELINE_DIR = STUDIO_ROOT / "baseline"


def http_json(opener, url, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    with opener.open(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(f"{url} 返回错误: {body['error']}")
    return body


def login(opener, base_url, username, password):
    payload = {
        "username": username,
        "password": password,
        "acceptedTermsVersion": LEGAL_CONSENT_VERSION,
    }
    return http_json(opener, base_url.rstrip("/") + "/api/v1/auth/login", payload)


def fetch_shared_content(opener, base_url, subject):
    query = urllib.parse.urlencode({"subjectId": subject})
    url = base_url.rstrip("/") + "/api/v1/content-prep/shared-content?" + query
    return http_json(opener, url)


def build_baseline(shared):
    baseline = {key: shared.get(key) for key in BASELINE_KEYS}
    baseline["subjectId"] = shared.get("subjectId")
    baseline["contentRevision"] = shared.get("contentRevision")
    baseline["fetchedFrom"] = "content-prep/shared-content"
    return baseline


def tree_paths(taxonomy):
    """知识树节点 -> {id: 完整路径文本}"""
    nodes = taxonomy.get("nodes", []) if taxonomy else []
    by_id = {n.get("id"): n for n in nodes}
    cache = {}

    def path_of(node):
        nid = node.get("id")
        if nid in cache:
            return cache[nid]
        title = node.get("title")
        if isinstance(title, dict):
            title = title.get("zh") or title.get("en") or ""
        parts = [str(title or nid)]
        parent = by_id.get(node.get("parentId"))
        seen = {nid}
        while parent and parent.get("id") not in seen:
            seen.add(parent.get("id"))
            ptitle = parent.get("title")
            if isinstance(ptitle, dict):
                ptitle = ptitle.get("zh") or ptitle.get("en") or ""
            parts.append(str(ptitle or parent.get("id") or ""))
            parent = by_id.get(parent.get("parentId"))
        cache[nid] = " / ".join(reversed(parts))
        return cache[nid]

    return by_id, path_of


def build_cheatsheet(baseline, subject):
    lines = [f"# Prep Studio 基线 ID 速查表(subject: {subject})", ""]
    lines.append("> 供大模型做「文档 → 题目 JSON」转换时引用。所有 ID 必须原样使用,禁止自造。")
    lines.append("> 基线更新后由 scripts/fetch_baseline.py 自动重新生成本文件。")
    lines.append("")

    principles = (baseline.get("principles") or {}).get("items", [])
    lines.append(f"## 一、八大原则(共 {len(principles)} 条)")
    lines.append("")
    lines.append("| principleId | 名称 | 状态 |")
    lines.append("|---|---|---|")
    for p in principles:
        lines.append(f"| {p.get('id','')} | {p.get('name','')} | {p.get('status','')} |")
    lines.append("")

    taxonomy = (baseline.get("knowledgeTree") or {}).get("taxonomy") or baseline.get("knowledgeTree") or {}
    by_id, path_of = tree_paths(taxonomy)
    nodes = taxonomy.get("nodes", []) if taxonomy else []
    lines.append(f"## 二、知识树节点(共 {len(nodes)} 个)")
    lines.append("")
    lines.append("| nodeId | 完整路径 |")
    lines.append("|---|---|")
    for n in sorted(nodes, key=lambda x: (x.get("level") or 0, x.get("sortOrder") or 0)):
        lines.append(f"| {n.get('id','')} | {path_of(n)} |")
    lines.append("")

    recall = baseline.get("recallLibrary") or {}
    rnodes = recall.get("nodes", [])
    lines.append(f"## 三、联想库节点(共 {len(rnodes)} 个,关系 {len(recall.get('edges', []))} 条)")
    lines.append("")
    lines.append("| recallNodeId | 标题 | 英文 | aliases(前3) |")
    lines.append("|---|---|---|---|")
    for n in rnodes:
        aliases = ", ".join((n.get("aliases") or [])[:3])
        lines.append(f"| {n.get('id','')} | {n.get('title','')} | {n.get('titleEn','')} | {aliases} |")
    lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="拉取 Prep Studio 固定基准数据")
    parser.add_argument("--base-url", default="https://lszl.aihuanpu.com")
    parser.add_argument("--username", default=os.environ.get("PREP_BASELINE_USER", "admin"))
    parser.add_argument("--password", default=os.environ.get("PREP_BASELINE_PASS", "admin123"))
    parser.add_argument("--subject", default="PMP")
    args = parser.parse_args()

    jar = http.cookiejar.CookieJar()
    handlers = [urllib.request.HTTPCookieProcessor(jar)]
    if args.base_url.startswith("https://") and SSL_CONTEXT is not None:
        handlers.append(urllib.request.HTTPSHandler(context=SSL_CONTEXT))
    opener = urllib.request.build_opener(*handlers)

    print(f"[1/3] 登录 {args.base_url}(用户 {args.username})…")
    try:
        login(opener, args.base_url, args.username, args.password)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        if exc.code == 400 and "隐私政策" in detail:
            raise SystemExit(
                f"登录被拒:服务器要求的条款版本与脚本 LEGAL_CONSENT_VERSION({LEGAL_CONSENT_VERSION})不一致,"
                f"请对照 backend/app/api/v1/auth.py 的 LEGAL_CONSENT_VERSION 更新脚本。原始返回: {detail}"
            )
        raise

    print(f"[2/3] 拉取 shared-content(subjectId={args.subject})…")
    shared = fetch_shared_content(opener, args.base_url, args.subject)

    baseline = build_baseline(shared)
    missing = [k for k in BASELINE_KEYS if not baseline.get(k)]
    if missing:
        print(f"警告: shared-content 缺少以下部分(基线中将不含): {', '.join(missing)}")

    BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    out_json = BASELINE_DIR / "baseline.json"
    out_json.write_text(json.dumps(baseline, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size_kb = out_json.stat().st_size / 1024
    print(f"[3/3] 写入 {out_json}({size_kb:.0f} KB)")

    cheatsheet = build_cheatsheet(baseline, args.subject)
    out_md = BASELINE_DIR / "baseline-id-cheatsheet.md"
    out_md.write_text(cheatsheet, encoding="utf-8")
    print(f"      写入 {out_md}")

    print(
        "基线摘要: 知识树节点 {tn} 个 | 联想节点 {rn} 个/关系 {re} 条 | 原则 {pn} 条 | 归纳卡 {sn} 条".format(
            tn=len((baseline.get("knowledgeTree") or {}).get("taxonomy", {}).get("nodes", [])),
            rn=len((baseline.get("recallLibrary") or {}).get("nodes", [])),
            re=len((baseline.get("recallLibrary") or {}).get("edges", [])),
            pn=len((baseline.get("principles") or {}).get("items", [])),
            sn=len((baseline.get("synthesisPresets") or {}).get("items", [])),
        )
    )


if __name__ == "__main__":
    sys.exit(main())
