#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

os.chdir(Path(__file__).resolve().parent)
server = ThreadingHTTPServer(('127.0.0.1', 8000), SimpleHTTPRequestHandler)
print('Open: http://127.0.0.1:8000/index.html')
server.serve_forever()
