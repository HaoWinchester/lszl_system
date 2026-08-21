#!/usr/bin/env python3
from pathlib import Path
import argparse

ROOT=Path(__file__).resolve().parent
JS_ORDER=[
    "00-core-bootstrap.js",
    "10-state-domain.js",
    "12-p45-authoring-domain.js",
    "14-principle-bundle-domain.js",
    "16-recall-acceptance.js",
    "17-question-supplement.js",
    "18-baseline-bootstrap.js",
    "20-page-runtime.js",
    "21-question-edit-extras.js",
    "22-round3-extras.js",
    "30-service-layer.js",
    "32-p45-contract-service.js",
    "35-server-catalog-service.js",
    "36-server-draft-service.js",
    "37-shared-draft-ui.js",
    "38-shared-draft-autosave.js",
    "40-events-bootstrap.js",
    "45-server-events.js",
    "46-server-p45-adapter.js",
]

def build(output=None):
    template=(ROOT/"src"/"index.template.html").read_text(encoding="utf-8")
    css=(ROOT/"src"/"css"/"app.css").read_text(encoding="utf-8").rstrip()
    js="\n\n".join((ROOT/"src"/"js"/name).read_text(encoding="utf-8").rstrip() for name in JS_ORDER)
    product_release=(ROOT.parent/"VERSION").read_text(encoding="utf-8").strip()
    # 固定基准数据(知识树/联想库/原则/归纳卡/标签配置)内嵌;baseline.json 不存在时回退 null
    baseline_path=ROOT/"baseline"/"baseline.json"
    baseline="null"
    if baseline_path.exists():
        baseline=baseline_path.read_text(encoding="utf-8").strip() or "null"
        if "</" in baseline:  # 防止 JSON 内容截断 </script>
            baseline=baseline.replace("</","<\\/")
    result=template.replace("__PRODUCT_RELEASE__",product_release).replace("/*__BUILD_BASELINE__*/null",baseline).replace("/*__BUILD_CSS__*/",css).replace("/*__BUILD_JS__*/",js)
    out=Path(output) if output else ROOT/"dist"/"content-prep.html"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(result,encoding="utf-8")
    return out

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("-o","--output")
    args=ap.parse_args()
    print(build(args.output))
