#!/usr/bin/env python3
from pathlib import Path
import argparse

ROOT=Path(__file__).resolve().parent
JS_ORDER=[
    "00-core-bootstrap.js",
    "10-state-domain.js",
    "20-page-runtime.js",
    "30-service-layer.js",
    "35-server-catalog-service.js",
    "40-events-bootstrap.js",
    "45-server-events.js",
]

def build(output=None):
    template=(ROOT/"src"/"index.template.html").read_text(encoding="utf-8")
    css=(ROOT/"src"/"css"/"app.css").read_text(encoding="utf-8").rstrip()
    js="\n\n".join((ROOT/"src"/"js"/name).read_text(encoding="utf-8").rstrip() for name in JS_ORDER)
    result=template.replace("/*__BUILD_CSS__*/",css).replace("/*__BUILD_JS__*/",js)
    out=Path(output) if output else ROOT/"dist"/"content-prep.html"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(result,encoding="utf-8")
    return out

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("-o","--output")
    args=ap.parse_args()
    print(build(args.output))
