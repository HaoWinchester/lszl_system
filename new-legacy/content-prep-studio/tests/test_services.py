from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/"src"/"js"/"30-service-layer.js").read_text(encoding="utf-8")
required=["TagService","QuestionService","StorageService","WorkspaceService","ImportService","ExportService","ValidationService","window.PMPPrepServices"]
missing=[x for x in required if x not in s]
if missing: raise SystemExit(f"missing services: {missing}")
print("service contracts: passed")
