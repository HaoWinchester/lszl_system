"""Run on the configured UAT host before this batch's data-only import.

Produces a private UAT code/database backup and validates both archives.
Never connects to the production database or changes running services.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
root = Path('/home/ubuntu/lszl-uat-backups') / ('pmp-documents-' + stamp)
root.mkdir(mode=0o700, parents=True)


def archive(command, filename):
    path = root / filename
    with path.open('wb') as output:
        subprocess.run(command, stdout=output, check=True)
    if not path.stat().st_size:
        raise RuntimeError('备份为空：' + filename)
    return path


code = archive(['tar', '-czf', '-', '--exclude=./.git', '--exclude=./backend/.venv',
                '--exclude=node_modules', '--exclude=**/__pycache__', '--exclude=*.pyc',
                '-C', '/home/ubuntu/lszl-kg-uat', '.'], 'uat-code.tar.gz')
database = archive(['docker', 'exec', 'lszl-kg-db-1', 'sh', '-c',
                    'exec pg_dump --format=custom --no-owner --no-acl -U "${POSTGRES_USER:-kg}" -d kg_graph_uat'], 'kg_graph_uat.dump')
subprocess.run(['tar', '-tzf', str(code)], stdout=subprocess.DEVNULL, check=True)
with database.open('rb') as source:
    subprocess.run(['docker', 'exec', '-i', 'lszl-kg-db-1', 'pg_restore', '--list'],
                   stdin=source, stdout=subprocess.DEVNULL, check=True)
images = {name: subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', name], text=True).strip()
          for name in ('lszl-kg-uat-backend-1', 'lszl-kg-backend-1')}
manifest = {'environment': 'uat', 'database': 'kg_graph_uat', 'backupTime': stamp,
            'backupDirectory': str(root), 'validated': True, 'imagesBefore': images,
            'files': [{'path': str(p), 'bytes': p.stat().st_size,
                       'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (code, database)]}
(root/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(manifest, ensure_ascii=False))
