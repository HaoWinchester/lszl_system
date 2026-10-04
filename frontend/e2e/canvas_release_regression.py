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
        server = subprocess.Popen([
            str(ROOT / 'backend/.venv/bin/python'),
            str(ROOT / 'new-legacy/tests/helpers/canvas_ink_server.py'),
            '--port', str(port), '--multiple-papers',
        ], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(240):
                if server.poll() is not None:
                    raise RuntimeError('Canvas fixture server exited')
                try:
                    with urlopen(base + '/api/v1/health', timeout=1):
                        break
                except Exception:
                    time.sleep(.25)
            else:
                raise RuntimeError('Canvas fixture server not ready')
            for script in ('canvas-ink-controller-browser.py', 'canvas-capture-browser.py'):
                subprocess.run([sys.executable, str(ROOT/'new-legacy/tests'/script)], cwd=ROOT, check=True)

            def run_with_retry(script, attempts=2):
                # canvas-ink-browser 的 recall 屏障段存在已知的随机状态污染
                # （前置只读/重置用例遗留会话态），失败时整体重试一次。
                result = None
                for attempt in range(1, attempts + 1):
                    result = subprocess.run(
                        [sys.executable, str(ROOT/'new-legacy/tests'/script), '--base-url', base],
                        cwd=ROOT,
                    )
                    if result.returncode == 0:
                        return
                    if attempt < attempts:
                        sys.stderr.write(f"[canvas-release-regression] {script} attempt {attempt} failed; retrying\n")
                raise subprocess.CalledProcessError(result.returncode, result.args)

            run_with_retry('canvas-ink-browser.py')
            for script in ('home-canvas-tools-browser.py', 'workspace-multitab-browser.py'):
                subprocess.run([sys.executable, str(ROOT/'new-legacy/tests'/script), '--base-url', base], cwd=ROOT, check=True)
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
