"""Run browser gates against an isolated migrated PostgreSQL database."""
import argparse,os,socket,subprocess,sys,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--server',default='practice_lobby_server.py')
parser.add_argument('--browser',default='practice-demand-loading-browser.py')
parser.add_argument('--artifacts',default='practice-lobby-demand')
parser.add_argument('--server-arg',action='append',default=[])
parser.add_argument('--extra-browser',action='append',default=[])
args=parser.parse_args()
OUT=ROOT/'artifacts'/args.artifacts;OUT.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:
    s.bind(('127.0.0.1',0));port=s.getsockname()[1]
base=f'http://127.0.0.1:{port}'
with (OUT/'gate-server.log').open('w') as log:
    server=subprocess.Popen([str(ROOT/'backend/.venv/bin/python'),str(ROOT/'new-legacy/tests/helpers'/args.server),'--port',str(port),*args.server_arg],cwd=ROOT,env=dict(os.environ),stdout=log,stderr=subprocess.STDOUT)
    try:
        deadline=time.monotonic()+45
        while True:
            if server.poll() is not None:raise RuntimeError(f'Practice gate server exited; see {OUT}/gate-server.log')
            try:
                with urllib.request.urlopen(base+'/api/v1/health',timeout=1) as r:
                    if r.status==200:break
            except OSError:
                if time.monotonic()>deadline:raise RuntimeError('Practice gate server health timeout')
                time.sleep(.2)
        for browser in [args.browser,*args.extra_browser]:
            subprocess.run([sys.executable,str(ROOT/'new-legacy/tests'/browser),'--base-url',base],cwd=ROOT,check=True)
    finally:
        server.terminate()
        try:server.wait(timeout=20)
        except subprocess.TimeoutExpired:server.kill();server.wait()
