"""Frame-time test: drive the built page in headless Chromium and report per-frame cost for pan, zoom and selection."""
import argparse
import json
import statistics
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

# Wraps draw() and records its cost, plus the gap between animation frames while a scenario runs.
PROBE = """
(() => {
  const inner = window.draw;
  window.__draws = [];
  window.draw = function () { const t = performance.now(); inner(); window.__draws.push(performance.now() - t); };
  const tile = window.renderTile;
  window.__tiles = [];
  window.renderTile = function (...a) { const t = performance.now(); const c = tile(...a); window.__tiles.push(performance.now() - t); return c; };
  window.__parts = {};
  for (const name of ['drawLevel', 'drawOverlay', 'drawBandNames', 'updateRibbon', 'labelSet']) {
    const f = window[name];
    window[name] = function (...a) { const t = performance.now(); const r = f(...a); window.__parts[name] = (window.__parts[name] || 0) + performance.now() - t; return r; };
  }
  window.__frames = [];
  let last = 0;
  const tick = t => { if (last) window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__reset = () => { window.__draws.length = 0; window.__frames.length = 0; window.__tiles.length = 0; window.__parts = {}; last = 0; };
})();
"""

# One synthetic wheel event per animation frame, like a fast trackpad or mouse wheel.
WHEEL = """
([n, dx, dy, x, y]) => new Promise(done => {
  const cv = document.getElementById('sky');
  let i = 0;
  const step = () => {
    cv.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (++i < n) requestAnimationFrame(step); else setTimeout(done, 400);
  };
  requestAnimationFrame(step);
})
"""


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else 0.0


def collect(page, name):
    d = page.evaluate('({ draws: window.__draws, frames: window.__frames, tiles: window.__tiles, parts: window.__parts })')
    draws, frames, tiles = d['draws'], d['frames'], d['tiles']
    return {
        'scenario': name,
        'draws': len(draws),
        'draw_p50_ms': round(statistics.median(draws), 2) if draws else 0,
        'draw_p95_ms': round(pct(draws, 95), 2),
        'draw_max_ms': round(max(draws, default=0), 2),
        'frame_p95_ms': round(pct(frames, 95), 2),
        'dropped_frames': sum(1 for f in frames if f > 25),
        'frames': len(frames),
        'tiles': len(tiles),
        'tile_p95_ms': round(pct(tiles, 95), 2),
        'per_draw_ms': {k: round(v / max(1, len(draws)), 2) for k, v in d['parts'].items()},
    }


def run(page, name, action):
    page.evaluate('window.__reset()')
    action()
    page.wait_for_timeout(300)
    return collect(page, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--page', type=Path, default=ROOT / 'dist' / 'index.html')
    ap.add_argument('--budget', type=float, default=8.0, help='fail if any scenario has draw p95 above this many ms')
    ap.add_argument('--dpr', type=float, default=2)
    ap.add_argument('--renderer', choices=['gpu', 'software'], default='gpu',
                    help='gpu uses the machine GPU through ANGLE/EGL; software is SwiftShader, a slow-device worst case')
    ap.add_argument('-v', '--verbose', action='store_true', help='also print time per draw spent in each part')
    args = ap.parse_args()
    w, h = 1440, 900
    with sync_playwright() as p:
        flags = ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] if args.renderer == 'gpu' else []
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=args.dpr)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.page.resolve().as_uri())
        page.wait_for_function('typeof draw === "function"')
        page.wait_for_timeout(800)
        page.evaluate(PROBE)
        cx, cy = w // 2, h // 2
        results = [
            run(page, 'wheel pan down', lambda: page.evaluate(WHEEL, [120, 0, 40, cx, cy])),
            run(page, 'wheel pan up', lambda: page.evaluate(WHEEL, [120, 0, -40, cx, cy])),
            run(page, 'wheel zoom in', lambda: page.evaluate(WHEEL, [24, 0, -100, cx, cy])),
            run(page, 'pan while zoomed in', lambda: page.evaluate(WHEEL, [90, 30, 30, cx, cy])),
            run(page, 'wheel zoom out', lambda: page.evaluate(WHEEL, [40, 0, 100, cx, cy])),
        ]

        def drag():
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(60):
                page.mouse.move(cx - i * 6, cy - i * 9)
            page.mouse.up()
        results.append(run(page, 'drag pan', drag))
        page.evaluate("select('arjuna', true)")
        page.wait_for_timeout(600)
        results.append(run(page, 'pan with selection', lambda: page.evaluate(WHEEL, [90, 0, 40, cx, cy])))
        browser.close()

    cols = ['scenario', 'draws', 'draw_p50_ms', 'draw_p95_ms', 'draw_max_ms', 'frame_p95_ms', 'dropped_frames', 'tiles', 'tile_p95_ms']
    print(' | '.join(f'{c:>14}' if c != 'scenario' else f'{c:<20}' for c in cols))
    for r in results:
        print(' | '.join(f'{r[c]:>14}' if c != 'scenario' else f'{r[c]:<20}' for c in cols))
        if args.verbose:
            print(f"{'':<20}   per draw: {r['per_draw_ms']}")
    if errors:
        print('page errors:', *errors, sep='\n  ', file=sys.stderr)
    worst = max(r['draw_p95_ms'] for r in results)
    (ROOT / 'dist' / 'perf.json').write_text(json.dumps(results, indent=1) + '\n')
    if errors or worst > args.budget:
        print(f'FAIL: draw p95 {worst} ms (budget {args.budget} ms)' if not errors else 'FAIL: page errors', file=sys.stderr)
        sys.exit(1)
    print(f'ok: worst draw p95 {worst} ms (budget {args.budget} ms)')


if __name__ == '__main__':
    main()
