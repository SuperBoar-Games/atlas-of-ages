// The graph view: tiled canvas rendering, camera, input, detail panel, filters and search.
import { TYPES, FILTERS, ORDER, TIER_TAG, TIER_NOTE, KIND_TAG, TIER_OPTIONS, YNAME } from './common.js';
import { PAL, edgeColor, nodeColor } from './theme.js';

// Links spanning more than this (world units, vertically) are faded until selected.
const FAR = 700;
const STRAIGHT = new Set(['line', 'gap', 'bond', 'story', 'reign', 'meet']);
// The graph is drawn into cached tiles per zoom level, as map engines do: panning only moves bitmaps,
// zooming scales them until the gesture rests, and the selection is painted as a live overlay on top.
const T = 256, MAX_TILES = 220, FRAME_BUDGET = 3;
// A critically damped spring (per ms) pulls the view to its goal and keeps velocity, so wheel notches
// blend into one steady motion instead of restarting an ease each time.
const OMEGA = 0.016, COAST_MS = 180;
const LABEL_FONT = '500 12.5px "Hanken Grotesk", system-ui, sans-serif';
const BAND_FONT = '400 30px "Tiro Devanagari Sanskrit", Georgia, serif';
const CELL = 120;

const levelFor = k => Math.round(Math.log2(k) * 2) / 2;
const sizeAt = k => Math.min(1.5, Math.max(0.6, Math.sqrt(k)));
// Curve side comes from the link's identity, so adding a link never flips the others.
const sideOf = k => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) | 0; return h & 1 ? 1 : -1; };

export function startGraph(model) {
  const { NODES, N, EDGES, DEG, BY_DEG, CHIRANJIVI, CATASTROPHES, filter, nodeShown, visible, focusSets, ancestry, relation } = model;
  const { W: WW, H: WH, head: HEAD, bands: BANDS, rail: RAIL } = model.layout;

  EDGES.forEach(e => {
    const a = N[e.f], b = N[e.t];
    if (!STRAIGHT.has(e.type)) {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(180, len * 0.16) * sideOf(`${e.f}>${e.t}>${e.type}`) * (e.type === 'part' ? 0.5 : 1);
      e.cx = (a.x + b.x) / 2 - dy / len * bend;
      e.cy = (a.y + b.y) / 2 + dx / len * bend;
    }
    e.bx0 = Math.min(a.x, b.x, e.cx ?? a.x); e.bx1 = Math.max(a.x, b.x, e.cx ?? a.x);
    e.by0 = Math.min(a.y, b.y, e.cy ?? a.y); e.by1 = Math.max(a.y, b.y, e.cy ?? a.y);
  });
  NODES.forEach(n => { n.r = 2.6 + Math.sqrt(DEG[n.id]) * 0.85; });

  const GRID = new Map();
  NODES.forEach(n => {
    const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
    if (!GRID.has(k)) GRID.set(k, []);
    GRID.get(k).push(n);
  });

  const $ = id => document.getElementById(id);
  const cv = $('sky'), ctx = cv.getContext('2d');
  const panel = $('panel'), ribbon = $('ribbon'), header = document.querySelector('.top');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cam = { x: 0, y: 0, k: 1 };
  let vw = 0, vh = 0, dpr = 1, fitK = 0.5, S = { l: 0, t: 0, r: 0, b: 0 }, ribGeom = [];
  let selected = null, sel = null, focusKey = null, foc = null, hover = null;

  const PERF = new URLSearchParams(location.search).has('perf');
  const stats = { draws: [], tiles: [], reset() { this.draws.length = 0; this.tiles.length = 0; } };

  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  const tiles = new Map(), labelSets = new Map();
  let baseVer = 0, level = null, prevLevel = null, zooming = false, zoomIdle = 0, firstFrame = true;
  function invalidate() { baseVer++; tiles.clear(); labelSets.clear(); redraw(); }
  function zoomMotion() {
    zooming = true;
    clearTimeout(zoomIdle);
    zoomIdle = setTimeout(() => { zooming = false; redraw(); }, 160);
  }

  const widthCache = new Map();
  function labelWidth(t) {
    let w = widthCache.get(t);
    if (w === undefined) { ctx.font = LABEL_FONT; w = ctx.measureText(t).width; widthCache.set(t, w); }
    return w;
  }

  // Paint helpers serve both tiles (world units) and the overlay (screen units); `unit` converts px to the target.

  const edgeBaseState = e => {
    const hit = foc && foc.edges.has(e.i);
    if (e.type === 'part' && !hit) return -1;
    return hit ? 3 : foc ? 0 : Math.abs(N[e.f].y - N[e.t].y) > FAR ? 1 : 2;
  };
  const nodeBaseState = n => foc ? (foc.nodes.has(n.id) ? 2 : foc.near.has(n.id) ? 1 : 0) : 1;

  function paintEdges(g, buckets, P, unit, lw) {
    for (const key of [...buckets.keys()].sort()) {
      const st = +key[0], type = key.slice(2);
      g.beginPath();
      for (const e of buckets.get(key)) {
        const a = N[e.f], b = N[e.t], [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
        g.moveTo(ax, ay);
        if (e.cx === undefined) g.lineTo(bx, by);
        else { const [cx, cy] = P(e.cx, e.cy); g.quadraticCurveTo(cx, cy, bx, by); }
      }
      const base = type === 'line' || type === 'reign' || type === 'story' ? 0.5 : type === 'part' ? 0.35 : 0.3;
      g.globalAlpha = [0.05, base * 0.3, base, 0.95, 1][st];
      g.strokeStyle = st === 4 ? PAL.gold : edgeColor(type);
      g.lineWidth = (st === 4 ? 2.8 : st === 3 ? lw * 1.7 : type === 'story' ? lw * 2.2 : lw) * unit;
      const dash = TYPES[type].dash;
      g.setLineDash(dash ? dash.map(d => d * unit) : []);
      g.lineCap = type === 'reborn' ? 'round' : 'butt';
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }

  function paintNodes(g, list, stOf, P, unit, rs, rings) {
    const groups = new Map();
    for (const n of list) {
      const st = stOf(n), style = n.tier !== 'core' && n.tier !== 'history' ? n.tier : 'solid';
      const key = `${st}|${n.kind}|${style}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    for (const key of [...groups.keys()].sort()) {
      const [st, kind, style] = key.split('|');
      g.globalAlpha = st === '0' ? 0.16 : 1;
      g.beginPath();
      for (const n of groups.get(key)) {
        const [x, y] = P(n.x, n.y), r = n.r * rs * (st === '2' ? 1.15 : 1) * unit;
        if (n.kind === 'event') { g.moveTo(x, y - r * 1.25); g.lineTo(x + r * 1.25, y); g.lineTo(x, y + r * 1.25); g.lineTo(x - r * 1.25, y); g.closePath(); }
        else if (n.kind === 'story') g.rect(x - r, y - r, r * 2, r * 2);
        else { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
      }
      const color = PAL['k-' + kind] || PAL['k-person'];
      if (style === 'solid') { g.fillStyle = color; g.fill(); }
      else {
        g.fillStyle = PAL.night; g.fill();
        g.strokeStyle = style === 'folk' ? PAL['k-avatar'] : color; g.lineWidth = 1.6 * unit;
        g.setLineDash((style === 'layer' ? [] : style === 'folk' ? [1, 2] : style === 'vulgate' ? [5, 2] : [2, 2]).map(d => d * unit));
        g.stroke(); g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
    if (!rings) return;
    g.lineWidth = 1.3 * unit;
    for (const [set, color, dash] of [[CHIRANJIVI, PAL.gold, []], [CATASTROPHES, PAL.kill, [3, 2]]]) {
      g.beginPath();
      for (const n of list) {
        if (!set.has(n.id) || !stOf(n)) continue;
        const [x, y] = P(n.x, n.y), r = (n.r * rs + 4.5) * unit;
        g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
      }
      g.strokeStyle = color; g.setLineDash(dash.map(d => d * unit)); g.stroke();
    }
    g.setLineDash([]);
  }

  function paintLabel(g, text, x, y, color) {
    g.lineWidth = 3.5; g.strokeStyle = PAL.night; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }

  // Labels are placed once per zoom level, so they never reshuffle while panning.
  function labelSet(z) {
    let set = labelSets.get(z);
    if (set) return set;
    const kz = 2 ** z, rs = sizeAt(kz), grid = new Map(), C = 64;
    const cells = (x, y, w, h, f) => {
      for (let i = Math.floor(x / C); i <= Math.floor((x + w) / C); i++) for (let j = Math.floor(y / C); j <= Math.floor((y + h) / C); j++) if (f(i * 65536 + j) === false) return false;
      return true;
    };
    const shown = BY_DEG.filter(n => nodeShown(n) && nodeBaseState(n));
    const order = [...shown.filter(n => nodeBaseState(n) === 2), ...shown.filter(n => nodeBaseState(n) === 1)];
    const limit = kz < 0.2 ? 40 : Infinity;
    set = [];
    for (const n of order) {
      if (set.length >= limit) break;
      const w = labelWidth(n.label), x = n.x * kz - w / 2, y = n.y * kz + n.r * rs + 4;
      const box = [x - 2, y, w + 4, 15];
      const free = cells(...box, key => (grid.get(key) || []).every(r => box[0] >= r[0] + r[2] || box[0] + box[2] <= r[0] || box[1] >= r[1] + r[3] || box[1] + box[3] <= r[1]));
      if (!free) continue;
      cells(...box, key => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(box); });
      set.push({ n, x, y, w, dim: !!foc && nodeBaseState(n) === 1 });
    }
    labelSets.set(z, set);
    return set;
  }

  function renderTile(z, tx, ty) {
    const t0 = PERF ? performance.now() : 0;
    const kz = 2 ** z, ws = T / kz, x0 = tx * ws, y0 = ty * ws, x1 = x0 + ws, y1 = y0 + ws;
    const px = Math.round(T * dpr);
    const c = Object.assign(document.createElement('canvas'), { width: px, height: px });
    const g = c.getContext('2d');
    g.setTransform(dpr * kz, 0, 0, dpr * kz, -x0 * kz * dpr, -y0 * kz * dpr);
    const pad = 6 / kz, buckets = new Map();
    for (const e of EDGES) {
      if (e.bx1 < x0 - pad || e.bx0 > x1 + pad || e.by1 < y0 - pad || e.by0 > y1 + pad || !visible(e)) continue;
      const st = edgeBaseState(e);
      if (st < 0) continue;
      const key = `${st}|${e.type}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    const W1 = (x, y) => [x, y];
    paintEdges(g, buckets, W1, 1 / kz, Math.min(1.6, Math.max(0.7, kz)));
    const npad = 24 / kz;
    const list = NODES.filter(n => nodeShown(n) && n.x > x0 - npad && n.x < x1 + npad && n.y > y0 - npad && n.y < y1 + npad);
    paintNodes(g, list, nodeBaseState, W1, 1 / kz, sizeAt(kz), kz > 0.3);
    g.setTransform(dpr, 0, 0, dpr, -tx * T * dpr, -ty * T * dpr);
    g.font = LABEL_FONT; g.textBaseline = 'top'; g.lineJoin = 'round';
    const lx0 = tx * T, ly0 = ty * T;
    for (const L of labelSet(z)) {
      if (L.x + L.w < lx0 - 4 || L.x > lx0 + T + 4 || L.y + 16 < ly0 || L.y > ly0 + T) continue;
      paintLabel(g, L.n.label, L.x, L.y, L.dim ? PAL.dim : PAL.star);
    }
    if (PERF) stats.tiles.push(performance.now() - t0);
    return c;
  }

  function tileRange(z, ring) {
    const kz = 2 ** z, s = cam.k / kz;
    const nx = Math.ceil(WW * kz / T) - 1, ny = Math.ceil(WH * kz / T) - 1;
    return [Math.max(0, Math.floor(-cam.x / s / T) - ring), Math.min(nx, Math.floor((vw - cam.x) / s / T) + ring),
      Math.max(0, Math.floor(-cam.y / s / T) - ring), Math.min(ny, Math.floor((vh - cam.y) / s / T) + ring)];
  }
  function getTile(z, tx, ty, deadline) {
    const key = `${baseVer}|${z}|${tx}|${ty}`;
    let c = tiles.get(key);
    if (c) { tiles.delete(key); tiles.set(key, c); return c; }
    if (performance.now() > deadline) return null;
    c = renderTile(z, tx, ty);
    tiles.set(key, c);
    if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
    return c;
  }
  function drawLevel(z, deadline) {
    const s = cam.k / 2 ** z, [tx0, tx1, ty0, ty1] = tileRange(z, 0);
    let complete = true;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const c = getTile(z, tx, ty, deadline);
      if (!c) { complete = false; continue; }
      const x = Math.round(tx * T * s + cam.x), y = Math.round(ty * T * s + cam.y);
      ctx.drawImage(c, x, y, Math.round((tx + 1) * T * s + cam.x) - x, Math.round((ty + 1) * T * s + cam.y) - y);
    }
    return complete;
  }
  // Spend what is left of the frame budget on the ring just outside the view.
  function aheadOf(deadline) {
    if (deadline === Infinity || zooming) return;
    const [tx0, tx1, ty0, ty1] = tileRange(level, 1);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (!getTile(level, tx, ty, deadline)) return;
  }
  // While idle, render a wider ring so the next pan finds tiles ready.
  let prefetchJob = 0;
  const idleCb = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
  function prefetch() {
    if (prefetchJob || level === null) return;
    prefetchJob = idleCb(dl => {
      prefetchJob = 0;
      if (zooming) return;
      const [tx0, tx1, ty0, ty1] = tileRange(level, 2), end = performance.now() + Math.max(2, dl.timeRemaining() - 1);
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!getTile(level, tx, ty, end)) { prefetch(); return; }
      }
    });
  }

  function draw() {
    const t0 = PERF ? performance.now() : 0;
    const k = cam.k, X = x => x * k + cam.x, Y = y => y * k + cam.y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAL.night; ctx.fillRect(0, 0, vw, vh);
    // Band shading runs the full window width under the transparent tiles.
    ctx.fillStyle = PAL.band;
    BANDS.forEach((b, i) => { if (i % 2 === 0) ctx.fillRect(0, Y(b.y0), vw, (b.y1 - b.y0) * k); });
    ctx.fillStyle = PAL.rule; ctx.fillRect(Math.round(X(RAIL.x0)), Y(0), 1, WH * k);
    const want = levelFor(k);
    if (level === null) level = want;
    else if (want !== level && (!zooming || Math.abs(want - level) >= 1.5)) { prevLevel = level; level = want; }
    if (prevLevel !== null) drawLevel(prevLevel, 0);
    const deadline = firstFrame ? Infinity : performance.now() + FRAME_BUDGET;
    const complete = drawLevel(level, deadline);
    firstFrame = false;
    if (complete) { prevLevel = null; aheadOf(deadline); prefetch(); } else redraw();
    drawOverlay(X, Y);
    drawBandNames(X, Y);
    updateRibbon();
    if (PERF) stats.draws.push(performance.now() - t0);
  }

  function drawOverlay(X, Y) {
    const k = cam.k, rs = sizeAt(k), P = (x, y) => [X(x), Y(y)];
    ctx.font = LABEL_FONT; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    if (sel) {
      ctx.globalAlpha = 0.8; ctx.fillStyle = PAL.night; ctx.fillRect(0, 0, vw, vh); ctx.globalAlpha = 1;
      const buckets = new Map();
      for (const i of new Set([...sel.edges, ...sel.ancE])) {
        const e = EDGES[i], key = `${sel.ancE.has(i) ? 4 : 3}|${e.type}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(e);
      }
      paintEdges(ctx, buckets, P, 1, Math.min(1.6, Math.max(0.7, k)));
      const list = [...new Set([selected, ...sel.nodes, ...sel.ancN])].map(i => N[i]).filter(nodeShown);
      paintNodes(ctx, list, () => 2, P, 1, rs, true);
      const n = N[selected], [x, y] = P(n.x, n.y);
      ctx.beginPath(); ctx.arc(x, y, n.r * rs + 7, 0, Math.PI * 2);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2.2; ctx.stroke();
      const taken = [];
      const order = [n, ...list.filter(m => m !== n).sort((a, b) => DEG[b.id] - DEG[a.id])];
      for (const m of order) {
        const w = labelWidth(m.label), [mx, my] = P(m.x, m.y), lx = mx - w / 2, ly = my + m.r * rs * 1.15 + 4;
        if (lx > vw || lx + w < 0 || ly > vh || ly + 15 < 0) continue;
        if (m !== n && taken.some(r => lx < r[0] + r[2] && lx + w > r[0] && ly < r[1] + 15 && ly + 15 > r[1])) continue;
        taken.push([lx - 2, ly, w + 4]);
        paintLabel(ctx, m.label, lx, ly, PAL.star);
      }
    }
    if (hover && hover !== selected && nodeShown(N[hover])) {
      const n = N[hover], [x, y] = P(n.x, n.y), w = labelWidth(n.label);
      ctx.beginPath(); ctx.arc(x, y, n.r * rs + 5, 0, Math.PI * 2);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.6; ctx.stroke();
      paintLabel(ctx, n.label, x - w / 2, y + n.r * rs + 4, PAL.star);
    }
  }

  function drawBandNames(X, Y) {
    ctx.textBaseline = 'alphabetic';
    BANDS.forEach(b => {
      const y0 = Y(b.y0), y1 = Y(b.y1);
      if (y1 < S.t || y0 > vh) return;
      // Names live in the empty head of each band; when that shrinks on zoom-out, so does the name.
      const roomy = HEAD * cam.k >= 96;
      const y = roomy ? Math.min(y1 - 30, Math.max(y0 + 54, S.t + 46)) : y0 + Math.max(16, HEAD * cam.k * 0.6);
      const x = Math.max(S.l + 18, X(0) + 18);
      ctx.font = roomy ? BAND_FONT : '400 18px "Tiro Devanagari Sanskrit", Georgia, serif';
      ctx.fillStyle = PAL.star; ctx.globalAlpha = 0.85;
      ctx.fillText(b.name, x, y);
      ctx.globalAlpha = 1;
      if (!roomy) return;
      ctx.font = '400 13.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.fillStyle = PAL.dim;
      ctx.fillText(b.note, x, y + 22);
    });
    const rx = X((RAIL.x0 + RAIL.x1) / 2);
    if (rx > S.l && rx < vw) {
      ctx.font = '400 20px "Tiro Devanagari Sanskrit", Georgia, serif'; ctx.fillStyle = PAL.star; ctx.globalAlpha = .85; ctx.textAlign = 'center';
      ctx.fillText(RAIL.name, rx, Math.max(S.t + 30, Y(0) + 40));
      ctx.textAlign = 'start'; ctx.globalAlpha = 1;
    }
  }

  const ribbonBtns = BANDS.map(b => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.setProperty('--w', b.years ? b.years / 432000 : 0.8);
    if (!b.years) btn.classList.add('short');
    btn.innerHTML = `<span>${b.name.replace(' Yuga', '')}</span>`;
    btn.title = b.years ? `${b.name}: ${b.years.toLocaleString('en')} years by tradition` : `${b.name}: ${b.note}`;
    btn.setAttribute('aria-label', btn.title);
    btn.onclick = () => flyTo(cam.x, S.t + 10 - b.y0 * cam.k, cam.k);
    ribbon.appendChild(btn);
    return btn;
  });
  const here = document.createElement('div');
  here.className = 'here';
  ribbon.appendChild(here);
  let ribAt = -1;
  function updateRibbon() {
    const wy = ((S.t + vh - S.b) / 2 - cam.y) / cam.k;
    let at = BANDS.findIndex(b => wy < b.y1);
    if (at < 0) at = BANDS.length - 1;
    if (at !== ribAt) { ribAt = at; ribbonBtns.forEach((b, i) => b.setAttribute('aria-current', String(i === at))); }
    const b = BANDS[at], [top, height] = ribGeom[at] || [0, 0];
    const f = Math.min(1, Math.max(0, (wy - b.y0) / (b.y1 - b.y0)));
    here.style.transform = `translateY(${top + f * (height - 2)}px)`;
  }

  function resize() {
    const d = Math.min(2, devicePixelRatio || 1);
    if (d !== dpr) { dpr = d; tiles.clear(); }
    vw = innerWidth; vh = innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    const wide = vw > 760;
    S = { l: ribbon.offsetWidth, t: header.offsetHeight, r: wide && !panel.hidden ? 412 : 0, b: !wide && !panel.hidden ? panel.offsetHeight : 0 };
    ribGeom = ribbonBtns.map(b => [b.offsetTop, b.offsetHeight]);
    fitK = (vw - S.l - S.r - 24) / WW;
    redraw();
  }
  const clampK = k => Math.min(3, Math.max(fitK * 0.5, k));
  function clampCam(c = cam) {
    c.k = clampK(c.k);
    const avail = vw - S.l - S.r, wide = WW * c.k;
    c.x = wide <= avail ? S.l + (avail - wide) / 2 : Math.min(S.l + 24, Math.max(vw - S.r - 24 - wide, c.x));
    c.y = Math.min(S.t + 40, Math.max(vh - S.b - 80 - WH * c.k, c.y));
  }
  const viewCenter = () => [(S.l + vw - S.r) / 2, (S.t + vh - S.b) / 2];

  const goal = { x: 0, y: 0, k: 1 }, vel = { x: 0, y: 0, z: 0 };
  let anchor = null, glideRaf = 0, glideT = 0;
  function syncGoal() { goal.x = cam.x; goal.y = cam.y; goal.k = cam.k; anchor = null; vel.x = vel.y = vel.z = 0; }
  function stopGlide() { cancelAnimationFrame(glideRaf); glideRaf = 0; syncGoal(); }
  function glide() { if (!glideRaf) { glideT = performance.now(); glideRaf = requestAnimationFrame(stepGlide); } }
  function stepGlide(now) {
    glideRaf = 0;
    const dt = Math.min(32, Math.max(1, now - glideT));
    glideT = now;
    // Spring state: offset of the world point under the anchor from its goal, and log zoom from the goal zoom.
    const [ax, ay] = anchor || viewCenter();
    const gx = (ax - goal.x) / goal.k, gy = (ay - goal.y) / goal.k;
    let ex = (ax - cam.x) / cam.k - gx, ey = (ay - cam.y) / cam.k - gy, ez = Math.log(cam.k / goal.k);
    if (reduced.matches) ex = ey = ez = vel.x = vel.y = vel.z = 0;
    vel.x += (-OMEGA * OMEGA * ex - 2 * OMEGA * vel.x) * dt; ex += vel.x * dt;
    vel.y += (-OMEGA * OMEGA * ey - 2 * OMEGA * vel.y) * dt; ey += vel.y * dt;
    vel.z += (-OMEGA * OMEGA * ez - 2 * OMEGA * vel.z) * dt; ez += vel.z * dt;
    const k = goal.k * Math.exp(ez);
    if (k !== cam.k) zoomMotion();
    cam.k = k;
    cam.x = ax - (gx + ex) * k;
    cam.y = ay - (gy + ey) * k;
    const rest = Math.hypot(ex, ey) * k < 0.3 && Math.abs(ez) < 1e-3 && Math.hypot(vel.x, vel.y) * k * 16 < 0.3 && Math.abs(vel.z) * 16 < 1e-3;
    if (rest) { cam.x = goal.x; cam.y = goal.y; cam.k = goal.k; syncGoal(); }
    else glideRaf = requestAnimationFrame(stepGlide);
    draw();
  }
  function panBy(dx, dy) {
    if (!glideRaf) syncGoal();
    goal.x += dx; goal.y += dy;
    clampCam(goal); glide();
  }
  function zoomAt(sx, sy, f) {
    if (!glideRaf) syncGoal();
    const k = clampK(goal.k * f);
    goal.x = sx - (sx - goal.x) * (k / goal.k); goal.y = sy - (sy - goal.y) * (k / goal.k); goal.k = k;
    anchor = [sx, sy];
    clampCam(goal); glide();
  }
  // Pinch follows the fingers directly.
  function zoomNow(sx, sy, f) {
    const k = clampK(cam.k * f);
    cam.x = sx - (sx - cam.x) * (k / cam.k); cam.y = sy - (sy - cam.y) * (k / cam.k); cam.k = k;
    clampCam(); syncGoal(); zoomMotion(); redraw();
  }

  let anim = null;
  function flyTo(x, y, k) {
    const from = { ...cam }, t0 = performance.now(), dur = reduced.matches ? 0 : 420;
    cancelAnimationFrame(anim);
    stopGlide();
    const step = now => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1, q = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      cam.x = from.x + (x - from.x) * q; cam.y = from.y + (y - from.y) * q; cam.k = from.k + (k - from.k) * q;
      if (p < 1 && from.k !== k) zoomMotion();
      draw();
      if (p < 1) anim = requestAnimationFrame(step); else syncGoal();
    };
    anim = requestAnimationFrame(step);
  }
  function fit(animate = true) {
    const k = fitK, x = S.l + (vw - S.l - S.r - WW * k) / 2, y = S.t + 8;
    if (animate) flyTo(x, y, k); else { cam.x = x; cam.y = y; cam.k = k; syncGoal(); redraw(); }
  }
  function centerOn(n) {
    const k = Math.max(cam.k, 0.85), [cx, cy] = viewCenter();
    flyTo(cx - n.x * k, cy - n.y * k, k);
  }

  function hit(sx, sy) {
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y) / cam.k, rad = 14 / cam.k;
    let best = null, bd = Infinity;
    for (let i = Math.floor((wx - rad) / CELL); i <= Math.floor((wx + rad) / CELL); i++) for (let j = Math.floor((wy - rad) / CELL); j <= Math.floor((wy + rad) / CELL); j++) {
      for (const n of GRID.get(`${i},${j}`) || []) {
        if (!nodeShown(n)) continue;
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < rad + n.r && d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  const ptrs = new Map();
  let gesture = null;
  cv.addEventListener('pointerdown', ev => {
    cv.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    cancelAnimationFrame(anim);
    stopGlide();
    $('hint').hidden = true;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, moved: true };
    } else gesture = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false, trail: [[ev.timeStamp, ev.clientX, ev.clientY]] };
  });
  cv.addEventListener('pointermove', ev => {
    if (!ptrs.has(ev.pointerId)) {
      const n = hit(ev.clientX, ev.clientY), id = n ? n.id : null;
      cv.classList.toggle('pointing', !!n);
      if (id !== hover) { hover = id; redraw(); }
      return;
    }
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (gesture.pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomNow((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.k * d / gesture.d / cam.k);
      return;
    }
    const dx = ev.clientX - gesture.x, dy = ev.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) > 4) { gesture.moved = true; cv.classList.add('dragging'); }
    if (gesture.moved && !gesture.pinch) {
      cam.x = gesture.cx + dx; cam.y = gesture.cy + dy; clampCam(); syncGoal(); redraw();
      gesture.trail.push([ev.timeStamp, ev.clientX, ev.clientY]);
      while (gesture.trail.length > 2 && ev.timeStamp - gesture.trail[0][0] > 80) gesture.trail.shift();
    }
  });
  // A released drag keeps its speed for a moment and coasts to a stop.
  function coast(trail, t) {
    const [t0, x0, y0] = trail[0], [t1, x1, y1] = trail[trail.length - 1];
    if (t - t1 > 60 || t1 - t0 < 8) return;
    const vx = (x1 - x0) / (t1 - t0), vy = (y1 - y0) / (t1 - t0);
    if (Math.hypot(vx, vy) < 0.25) return;
    panBy(vx * COAST_MS, vy * COAST_MS);
  }
  const endPointer = ev => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    cv.classList.remove('dragging');
    if (ev.type === 'pointerup' && gesture && !gesture.moved && ptrs.size === 0) {
      const n = hit(ev.clientX, ev.clientY);
      if (n) select(n.id, false); else if (selected) select(null); else if (focusKey) setFocus(focusKey);
    }
    if (ev.type === 'pointerup' && gesture && gesture.moved && !gesture.pinch && ptrs.size === 0) coast(gesture.trail, ev.timeStamp);
    if (ptrs.size === 0) gesture = null;
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', () => { if (hover && !ptrs.size) { hover = null; cv.classList.remove('pointing'); redraw(); } });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault();
    cancelAnimationFrame(anim);
    const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? vh : 1;
    // Ctrl or Cmd with the wheel (and a trackpad pinch, which arrives as Ctrl+wheel) zooms; plain wheel scrolls, Shift sideways.
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * unit * 0.0025));
    else if (ev.shiftKey && !ev.deltaX) panBy(-ev.deltaY * unit, 0);
    else panBy(-ev.deltaX * unit, -ev.deltaY * unit);
  }, { passive: false });

  function select(id, fly) {
    if (id && focusKey) clearFocus();
    selected = id;
    if (!id) { sel = null; panel.hidden = true; resize(); return; }
    const n = N[id];
    const anc = ancestry(id);
    const links = EDGES.filter(e => (e.f === id || e.t === id) && visible(e));
    sel = { nodes: new Set([id, ...links.map(e => e.f === id ? e.t : e.f)]), edges: new Set(links.map(e => e.i)), ancN: anc.nodes, ancE: anc.edges };
    links.sort((a, b) => ORDER[a.type] - ORDER[b.type] || N[a.f === id ? a.t : a.f].y - N[b.f === id ? b.t : b.f].y);
    const age = n.yuga === 'deva' ? 'The gods' : BANDS.find(b => b.period === n.yuga).name;
    const chain = [...anc.nodes].map(i => N[i]).sort((a, b) => a.y - b.y || a.x - b.x);
    const src = n.sources;
    panel.innerHTML = `
      <div class="panel-head"><h2>${n.label}</h2><button type="button" class="btn close" id="close">Close</button></div>
      <div class="tags"><span class="tag age">${age}</span>${KIND_TAG[n.kind] && n.yuga !== 'deva' ? `<span class="tag">${KIND_TAG[n.kind]}</span>` : ''}${n.yuga !== 'deva' && n.tier ? `<span class="tag">${TIER_TAG[n.tier]}</span>` : ''}${CHIRANJIVI.has(id) ? '<span class="tag">Chiranjivi</span>' : n.span ? '<span class="tag">Lives across ages</span>' : ''}${CATASTROPHES.has(id) ? '<span class="tag">Catastrophe</span>' : ''}</div>
      <p>${n.desc}</p>
      ${src.length ? `<h3>Sources</h3><div class="cites">${src.map(([t, u], j) => `<a href="${u}" target="_blank" rel="noopener"${j >= 8 ? ' hidden' : ''}>${t}</a>`).join('')}${src.length > 8 ? `<button type="button" class="more">${src.length - 8} more</button>` : ''}</div>` : ''}
      ${chain.length ? `<h3>Line of descent, ${chain.length} ${chain.length === 1 ? 'ancestor' : 'ancestors'}</h3><div class="trace">${chain.map(c => `<button type="button" data-go="${c.id}">${c.label}</button><span class="sep" aria-hidden="true">›</span>`).join('')}<b>${n.label}</b></div>` : ''}
      ${links.length ? `<h3>Links, ${links.length}</h3><div class="links">${links.map(e => {
        const o = N[e.f === id ? e.t : e.f];
        return `<button type="button" data-go="${o.id}"><span class="ln" style="background:${edgeColor(e.type)}"></span><span>${o.label}<span class="how">${relation(e, id)}${TIER_NOTE[e.tier] || ''}${e.xy ? `, ${YNAME[N[e.f].yuga]} to ${YNAME[N[e.t].yuga]}` : ''}</span></span></button>`;
      }).join('')}</div>` : ''}`;
    const wasHidden = panel.hidden;
    panel.hidden = false;
    panel.scrollTop = 0;
    if (wasHidden) resize();
    if (fly) centerOn(n); else redraw();
  }
  panel.addEventListener('click', ev => {
    if (ev.target.closest('#close')) { select(null); return; }
    const more = ev.target.closest('.more');
    if (more) { panel.querySelectorAll('.cites a[hidden]').forEach(a => { a.hidden = false; }); more.remove(); return; }
    const go = ev.target.closest('[data-go]');
    if (go) select(go.dataset.go, true);
  });

  const filtersBtn = $('filtersBtn'), filters = $('filters');
  const chipHTML = list => list.map(([k, label]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="false">${label}<span class="n"></span></button>`).join('');
  $('markChips').innerHTML = chipHTML(model.MARKS);
  $('beingChips').innerHTML = chipHTML(model.BEINGS);
  $('roleChips').innerHTML = chipHTML(model.ROLES);
  function updateCounts() {
    document.querySelectorAll('.chip[data-k]').forEach(b => {
      const { nodes, edges } = focusSets(b.dataset.k);
      const c = b.dataset.k === 'vulgate' || b.dataset.k === 'cross' ? edges.size : nodes.size;
      b.hidden = !c;
      b.querySelector('.n').textContent = c;
    });
    const links = EDGES.filter(e => e.type !== 'part' && visible(e)).length;
    $('stats').textContent = `${NODES.filter(nodeShown).length} figures and events, ${links} links`;
  }
  function syncFiltersBtn() { filtersBtn.classList.toggle('on', filter.off.size > 0 || filter.srcLevel < 4 || !!focusKey); }
  function clearFocus() {
    focusKey = null; foc = null;
    document.querySelectorAll('.chip[data-k]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    syncFiltersBtn();
  }
  function setFocus(k) {
    const same = focusKey === k;
    clearFocus();
    if (!same) {
      if (selected) select(null);
      focusKey = k; foc = focusSets(k);
      document.querySelector(`.chip[data-k="${k}"]`).setAttribute('aria-pressed', 'true');
    }
    syncFiltersBtn();
    invalidate();
  }
  filters.addEventListener('click', ev => {
    const c = ev.target.closest('.chip[data-k]');
    if (c) setFocus(c.dataset.k);
  });
  const linkChips = $('linkChips');
  linkChips.innerHTML = FILTERS.map(f => `<button type="button" class="chip toggle" data-f="${f}" aria-pressed="true"><span class="ln" data-c="${f}"></span>${TYPES[f].label}</button>`).join('');
  linkChips.addEventListener('click', ev => {
    const c = ev.target.closest('[data-f]');
    if (!c) return;
    const f = c.dataset.f, on = filter.off.has(f);
    if (on) filter.off.delete(f); else filter.off.add(f);
    c.setAttribute('aria-pressed', String(on));
    refilter();
  });
  const tierSeg = $('tierSeg');
  tierSeg.innerHTML = TIER_OPTIONS.map((t, i) => `<button type="button" role="radio" data-l="${i}" aria-checked="${i === filter.srcLevel}">${t}</button>`).join('');
  tierSeg.addEventListener('click', ev => {
    const b = ev.target.closest('[data-l]');
    if (!b) return;
    filter.srcLevel = +b.dataset.l;
    tierSeg.querySelectorAll('[data-l]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    refilter();
  });
  function refilter() {
    if (selected && !nodeShown(N[selected])) select(null);
    else if (selected) select(selected, false);
    if (focusKey) foc = focusSets(focusKey);
    updateCounts();
    syncFiltersBtn();
    invalidate();
  }
  filtersBtn.onclick = () => {
    const open = filters.hidden;
    filters.hidden = !open;
    filtersBtn.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('pointerdown', ev => {
    if (!filters.hidden && !filters.contains(ev.target) && ev.target !== filtersBtn) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); }
  });

  const qIn = $('q'), qRes = $('qres');
  let qHits = [], qAt = -1;
  const placeOf = n => n.yuga === 'deva' ? 'The gods' : BANDS.find(b => b.period === n.yuga).name;
  function qClose() { qRes.hidden = true; qIn.setAttribute('aria-expanded', 'false'); qIn.removeAttribute('aria-activedescendant'); qAt = -1; }
  function qPick(n) { qClose(); qIn.value = ''; qIn.blur(); select(n.id, true); }
  function qShow() {
    if (!qIn.value.trim()) { qClose(); return; }
    qHits = model.search(qIn.value);
    qRes.innerHTML = qHits.length ? qHits.map((n, i) =>
      `<li role="option" id="qr-${i}" data-i="${i}" aria-selected="false"><span class="sw" style="background:${nodeColor(n)}"></span><span>${n.label}<span class="where">${placeOf(n)}${KIND_TAG[n.kind] && n.yuga !== 'deva' ? `, ${KIND_TAG[n.kind].toLowerCase()}` : ''}</span></span></li>`).join('')
      : '<li class="empty">No names match. Try part of a name or a word from a description.</li>';
    qRes.hidden = false; qIn.setAttribute('aria-expanded', 'true'); qAt = -1;
  }
  function qMove(i) {
    if (!qHits.length) return;
    qAt = (i + qHits.length) % qHits.length;
    qRes.querySelectorAll('li[data-i]').forEach((li, j) => li.setAttribute('aria-selected', String(j === qAt)));
    qIn.setAttribute('aria-activedescendant', `qr-${qAt}`);
    qRes.querySelector(`#qr-${qAt}`).scrollIntoView({ block: 'nearest' });
  }
  qIn.addEventListener('input', qShow);
  qIn.addEventListener('focus', qShow);
  qIn.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); qMove(qAt + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); qMove(qAt - 1); }
    else if (ev.key === 'Enter') { const n = qHits[Math.max(0, qAt)]; if (n) qPick(n); }
    else if (ev.key === 'Escape') { qClose(); qIn.blur(); }
  });
  qRes.addEventListener('mousedown', ev => ev.preventDefault());
  qRes.addEventListener('click', ev => { const li = ev.target.closest('li[data-i]'); if (li) qPick(qHits[+li.dataset.i]); });
  qIn.addEventListener('blur', () => setTimeout(qClose, 120));

  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input')) return;
    const [cx, cy] = viewCenter();
    if (ev.key === '/') { ev.preventDefault(); qIn.focus(); }
    else if (ev.key === 'Escape') {
      if (!filters.hidden) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); }
      else if (selected) select(null);
      else if (focusKey) setFocus(focusKey);
    }
    else if (ev.key === '+' || ev.key === '=') zoomAt(cx, cy, 1.25);
    else if (ev.key === '-') zoomAt(cx, cy, 0.8);
    else if (ev.key === '0') fit();
    else if (ev.key.startsWith('Arrow')) {
      const d = 90, m = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[ev.key];
      panBy(m[0], m[1]);
    }
  });
  $('zin').onclick = () => zoomAt(...viewCenter(), 1.3);
  $('zout').onclick = () => zoomAt(...viewCenter(), 1 / 1.3);
  $('zfit').onclick = () => fit();

  addEventListener('resize', () => { resize(); clampCam(); syncGoal(); });
  if (document.fonts) document.fonts.ready.then(() => { widthCache.clear(); invalidate(); });

  const view = {
    // Called once the palette is read, and again whenever the theme changes.
    themeChanged() {
      linkChips.querySelectorAll('[data-c]').forEach(s => { s.style.background = edgeColor(s.dataset.c); });
      invalidate();
    },
    start() { resize(); updateCounts(); fit(false); },
  };
  if (PERF) window.__yc = { cam, stats, select, idle: () => glideRaf === 0 && !zooming };
  return view;
}
