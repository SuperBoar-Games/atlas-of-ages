"""Dev server: rebuild on any source change and live-reload the browser."""
import argparse
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCH = ['graph', 'ontology', 'shapes', 'layout', 'web', 'basemap', 'tools/build.py', 'tools/layout.py']
RELOAD = b"<script>new EventSource('/__reload').onmessage = () => location.reload();</script>"
version = 0
changed = threading.Condition()


def snapshot():
    files = []
    for w in WATCH:
        p = ROOT / w
        files += [p] if p.is_file() else [f for f in p.rglob('*') if f.is_file()]
    return {f: f.stat().st_mtime_ns for f in files}


def build():
    global version
    t0 = time.monotonic()
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build.py'), 'build', '--quick'], capture_output=True, text=True)
    stamp = time.strftime('%H:%M:%S')
    if r.returncode:
        print(f'[{stamp}] build failed\n{r.stderr or r.stdout}', flush=True)
        return
    print(f'[{stamp}] rebuilt in {time.monotonic() - t0:.1f}s: {r.stdout.strip().splitlines()[-1]}', flush=True)
    with changed:
        version += 1
        changed.notify_all()


def watch():
    seen = snapshot()
    while True:
        time.sleep(0.4)
        now = snapshot()
        if now != seen:
            seen = now
            build()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path == '/__reload':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            with changed:
                start = version
                changed.wait_for(lambda: version != start)
            try:
                self.wfile.write(b'data: reload\n\n')
            except BrokenPipeError:
                pass
            return
        if self.path.split('?')[0] in ('/', '/index.html'):
            body = (ROOT / 'dist' / 'index.html').read_bytes().replace(b'</body>', RELOAD + b'</body>')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--port', type=int, default=8000)
    port = ap.parse_args().port
    build()
    threading.Thread(target=watch, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(ROOT / 'dist')))
    server.daemon_threads = True
    print(f'serving http://127.0.0.1:{port}/', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
