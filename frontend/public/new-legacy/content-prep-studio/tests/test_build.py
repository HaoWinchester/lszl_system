from pathlib import Path
import subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/"dist"/"_test_build.html"
subprocess.run([sys.executable,str(ROOT/"build.py"),"-o",str(out)],check=True)
released=ROOT/"dist"/"content-prep.html"
if released.exists() and out.read_bytes()!=released.read_bytes():
    raise SystemExit("build output differs from release dist")
print("build reproducibility: passed")
out.unlink(missing_ok=True)
