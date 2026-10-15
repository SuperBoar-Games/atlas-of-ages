"""Frame test: drive the built page in headless Chromium and measure cost per frame and how smoothly the view moves."""
import argparse
import json
import math
import statistics
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

# The page, opened with ?perf, times its own draws and tiles in window.__yc; this samples the camera every frame.
PROBE = """
(() => {
  const yc = window.__yc;
  window.__frames = [];
  window.__cams = [];
  let last = 0;
  const tick = t => {
    if (last) window.__frames.push(t - last);
    last = t;
    window.__cams.push([yc.cam.x, yc.cam.y, yc.cam.k, t]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__reset = () => { yc.stats.reset(); window.__frames.length = 0; window.__cams.length = 0; last = 0; };
})();
"""

# n wheel events, one every `every` animation frames: every=1 is a trackpad stream, every=4 is mouse-wheel notches.
WHEEL = """
([n, every, dx, dy, ctrl, x, y]) => new Promise(done => {
  const cv = document.getElementById('sky');
  let i = 0, f = 0;
  const step = () => {
    if (f++ % every === 0) {
      cv.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey: ctrl, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      if (++i >= n) { setTimeout(done, 600); return; }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})
"""


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else 0.0


def smoothness(cams, w, h):
    """Per frame, the largest on-screen move of the content at the view's centre and 300 px around it."""
    cx, cy = w / 2, h / 2
    pts = [(cx, cy), (cx - 300, cy), (cx + 300, cy), (cx, cy - 300), (cx, cy + 300)]

    def step(a, b):
        return max(math.hypot((px - a[0]) / a[2] * b[2] + b[0] - px, (py - a[1]) / a[2] * b[2] + b[1] - py) for px, py in pts)
    steps = [step(a, b) for a, b in zip(cams, cams[1:])]
    moving = [i for i, s in enumerate(steps) if s > 0.05]
    if not moving:
        return 0.0, 0, 0
    window = steps[moving[0]:moving[-1] + 1]
    # A jerk is a frame whose speed (px per 16.7 ms) is far above the frame before: stepped, not eased, motion.
    # Speed rather than distance, so a late frame counts as a dropped frame, not also as a jerk.
    times = [b[3] - a[3] for a, b in zip(cams, cams[1:])][moving[0]:moving[-1] + 1]
    speed = [s / max(t, 1) * 16.7 for s, t in zip(window, times)]
    jerks = sum(1 for a, b in zip(speed, speed[1:]) if a > 0.05 and b > 12 and b > 2.5 * a)
    return max(window), sum(1 for s in window if s <= 0.05), jerks


def collect(page, name):
    d = page.evaluate('({ draws: __yc.stats.draws, tiles: __yc.stats.tiles, frames: __frames, cams: __cams, w: innerWidth, h: innerHeight })')
    draws, frames, tiles = d['draws'], d['frames'], d['tiles']
    jump, still, jerks = smoothness(d['cams'], d['w'], d['h'])
    return {
        'scenario': name,
        'draw_p50_ms': round(statistics.median(draws), 2) if draws else 0,
        'draw_p95_ms': round(pct(draws, 95), 2),
        'frame_p95_ms': round(pct(frames, 95), 2),
        'dropped_frames': sum(1 for f in frames if f > 25),
        'max_step_px': round(jump, 1),
        'jerks': jerks,
        'still_frames': still,
        'tiles': len(tiles),
    }


def run(page, name, action):
    page.wait_for_function('__yc.idle()')
    page.wait_for_timeout(500)
    page.evaluate('__reset()')
    action()
    page.wait_for_timeout(300)
    return collect(page, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--site', type=Path, default=ROOT / 'dist', help='built site to serve')
    ap.add_argument('--budget', type=float, default=8.0, help='fail if any scenario has draw p95 above this many ms')
    ap.add_argument('--dpr', type=float, default=2)
    ap.add_argument('--renderer', choices=['gpu', 'software'], default='gpu',
                    help='gpu uses the machine GPU through ANGLE/EGL; software is SwiftShader, a slow-device worst case')
    ap.add_argument('--shot', type=Path, help='also save a screenshot of the fitted view here')
    args = ap.parse_args()
    w, h = 1440, 900
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(args.site)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        flags = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] if args.renderer == 'gpu' else []
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=args.dpr)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/?perf')
        page.wait_for_function('window.__yc')
        page.wait_for_timeout(800)
        if args.shot:
            page.screenshot(path=str(args.shot))
        page.evaluate(PROBE)
        cx, cy = w // 2, h // 2
        wheel = lambda *a: lambda: page.evaluate(WHEEL, [*a, cx, cy])
        results = [
            run(page, 'mouse wheel down', wheel(24, 4, 0, 100, False)),
            run(page, 'mouse wheel up', wheel(24, 4, 0, -100, False)),
            run(page, 'trackpad scroll', wheel(120, 1, 0, 14, False)),
            run(page, 'ctrl+wheel zoom in', wheel(10, 4, 0, -100, True)),
            run(page, 'trackpad pan zoomed', wheel(90, 1, 15, 15, False)),
            run(page, 'ctrl+wheel zoom out', wheel(14, 4, 0, 100, True)),
        ]

        def drag():
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(60):
                page.mouse.move(cx - i * 6, cy - i * 9)
            page.mouse.up()
        results.append(run(page, 'drag and coast', drag))
        page.evaluate("__yc.select('arjuna', true)")
        page.wait_for_timeout(600)
        results.append(run(page, 'wheel with selection', wheel(24, 4, 0, 100, False)))
        browser.close()

    cols = ['scenario', 'draw_p50_ms', 'draw_p95_ms', 'frame_p95_ms', 'dropped_frames', 'max_step_px', 'jerks', 'still_frames', 'tiles']
    print(' | '.join(f'{c:>13}' if c != 'scenario' else f'{c:<22}' for c in cols))
    for r in results:
        print(' | '.join(f'{r[c]:>13}' if c != 'scenario' else f'{r[c]:<22}' for c in cols))
    server.shutdown()
    (ROOT / 'dist' / 'perf.json').write_text(json.dumps(results, indent=1) + '\n')
    fails = [f'page error: {e}' for e in errors]
    fails += [f"{r['scenario']}: draw p95 {r['draw_p95_ms']} ms > {args.budget}" for r in results if r['draw_p95_ms'] > args.budget]
    fails += [f"{r['scenario']}: {r['jerks']} jerky frames" for r in results if r['jerks']]
    fails += [f"{r['scenario']}: view stood still for {r['still_frames']} frames mid-motion" for r in results if r['still_frames'] > 2]
    if fails:
        print('FAIL\n  ' + '\n  '.join(fails), file=sys.stderr)
        sys.exit(1)
    print('ok')


if __name__ == '__main__':
    main()
