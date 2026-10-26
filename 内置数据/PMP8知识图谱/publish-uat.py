"""Thin guarded service-layer package entrypoint; default is read-only."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'shared'))
from publication import main

if __name__ == '__main__':
    main(Path(__file__).resolve().parent, local=False)
