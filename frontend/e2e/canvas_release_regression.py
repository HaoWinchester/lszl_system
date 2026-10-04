"""Validate all canvas consumers against the candidate release and a disposable DB."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-root', required=True)
    args = parser.parse_args()
    release_root = Path(args.release_root).resolve()
    assert (release_root / 'current.json').is_file(), 'Candidate release pointer required'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    # The helper owns and drops its isolated database. Never inherit a live DB.
    env = dict(os.environ, CANVAS_TEST_RELEASE_ROOT=str(release_root))
    with tempfile.TemporaryFile(mode='w+') as log:
        server = None
        try:
            for script in ('canvas-ink-controller-browser.py', 'canvas-capture-browser.py'):
                subprocess.run([sys.executable, str(ROOT/'new-legacy/tests'/script)], cwd=ROOT, check=True)

            def start_canvas_server():
                server = subprocess.Popen([
                    str(ROOT / 'backend/.venv/bin/python'),
                    str(ROOT / 'new-legacy/tests/helpers/canvas_ink_server.py'),
                    '--port', str(port), '--multiple-papers',
                ], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
                for _ in range(240):
                    if server.poll() is not None:
                        raise RuntimeError('Canvas fixture server exited')
                    try:
                        with urlopen(base + '/api/v1/health', timeout=1):
                            return server
                    except Exception:
                        time.sleep(.25)
                server.terminate()
                raise RuntimeError('Canvas fixture server not ready')

            def stop_canvas_server(server):
                server.terminate()
                try:
                    server.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()

            def run_with_fresh_db(script, attempts=2):
                # 该用例的数据流假设干净数据库；失败重试时重启 fixture 服务器
                # （换新 DB）再整体重跑，而不是在已写入数据的库上重试。
                result = None
                server = start_canvas_server()
                for attempt in range(1, attempts + 1):
                    try:
                        result = subprocess.run(
                            [sys.executable, str(ROOT/'new-legacy/tests'/script), '--base-url', base],
                            cwd=ROOT,
                        )
                        if result.returncode == 0:
                            return
                    finally:
                        stop_canvas_server(server)
                    if attempt < attempts:
                        sys.stderr.write(f"[canvas-release-regression] {script} attempt {attempt} failed; retrying with a fresh database\n")
                        server = start_canvas_server()
                raise subprocess.CalledProcessError(result.returncode, result.args)

            run_with_fresh_db('canvas-ink-browser.py')
            server = start_canvas_server()
            try:
                for script in ('home-canvas-tools-browser.py', 'workspace-multitab-browser.py'):
                    subprocess.run([sys.executable, str(ROOT/'new-legacy/tests'/script), '--base-url', base], cwd=ROOT, check=True)
            finally:
                stop_canvas_server(server)
        except BaseException:
            log.seek(0)
            sys.stderr.write(log.read())
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=30)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == '__main__':
    main()
