"""Run danmaku regression with isolated migrated DB, then verify its removal."""
from pathlib import Path
import argparse
import json
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir',type=Path,default=ROOT/'artifacts/danmaku-image-design')
args=parser.parse_args()
OUT=args.output_dir.resolve();OUT.mkdir(parents=True,exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
with (OUT/'api-server.log').open('w+') as log:
    server=subprocess.Popen([str(ROOT/'backend/.venv/bin/python'),str(ROOT/'new-legacy/tests/helpers/canvas_ink_server.py'),'--port',str(port)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
    prefix=f'kg_pytest_{server.pid}_'
    result={'fixturePid':server.pid,'databasePrefix':prefix,'testExit':None,'fixtureExit':None,'remainingDatabases':None}
    try:
        for _ in range(240):
            if server.poll() is not None:raise RuntimeError('Disposable fixture exited; inspect api-server.log')
            try:
                with urlopen(f'http://127.0.0.1:{port}/api/v1/health',timeout=1):break
            except Exception:time.sleep(.25)
        else:raise RuntimeError('Disposable fixture startup timeout')
        completed=subprocess.run([sys.executable,str(ROOT/'new-legacy/tests/danmaku-api-browser.py'),'--base-url',f'http://127.0.0.1:{port}','--source-overrides','--output-dir',str(OUT)],cwd=ROOT)
        result['testExit']=completed.returncode
    finally:
        if server.poll() is None:server.terminate()
        result['fixtureExit']=server.wait(timeout=30)
        # The fixture owns this unique PID-prefixed DB; ignore other parallel tests.
        remaining=subprocess.check_output(['psql','--host','/tmp','--dbname','postgres','--tuples-only','--no-align','--command',f"SELECT datname FROM pg_database WHERE datname LIKE '{prefix}%';"],text=True).splitlines()
        result['remainingDatabases']=remaining
        (OUT/'api-fixture-cleanup.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
        assert server.returncode==0 and not remaining,'Disposable fixture cleanup failed'
    if result['testExit']!=0:sys.exit(result['testExit'] or 1)
