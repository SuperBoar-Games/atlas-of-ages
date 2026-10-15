// The graph view: tiled canvas rendering, detail panel, filters and search.
import { TYPES, FILTERS, ORDER, TIER_TAG, TIER_NOTE, KIND_TAG, TIER_OPTIONS, YNAME, fmtYears, PLACE_VERB, IDENT_NOTE, attachCamera } from './common.js';
import { PAL, edgeColor, nodeColor } from './theme.js';

// Links spanning more than this (world units, vertically) are faded until selected.
const FAR = 700;
const STRAIGHT = new Set(['line', 'gap', 'bond', 'story', 'reign', 'meet']);
// The graph is drawn into cached tiles per zoom level, as map engines do: panning only moves bitmaps,
// zooming scales them until the gesture rests, and the selection is painted as a live overlay on top.
const T = 512, MAX_TILES = 64, FRAME_BUDGET = 3;
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

  // Story steps are read in the Stories panel, not drawn: hovering or picking one rings its people on the graph.
  const isStep = n => n.kind === 'story';
  EDGES.forEach(e => {
    const a = N[e.f], b = N[e.t];
    if (isStep(a) || isStep(b)) e.quiet = true;
    if (isStep(a) && isStep(b)) { e.cx = (a.x + b.x) / 2; e.cy = Math.min(a.y, b.y) - Math.min(160, 24 + Math.abs(b.x - a.x) * 0.08); }
    else if (!STRAIGHT.has(e.type)) {
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
  const camera = attachCamera(cv, {
    insets: () => S, world: () => [WW, WH], minK: () => fitK * 0.5, maxK: 3,
    draw: () => draw(), redraw: () => redraw(), zoomed: () => zoomMotion(),
    tap: (x, y) => {
      const n = hit(x, y);
      if (n) select(n.id, false); else if (selected) select(null); else if (focusKey) setFocus(focusKey);
    },
    hover: (x, y) => {
      const n = x === null ? null : hit(x, y), id = n ? n.id : null;
      cv.classList.toggle('pointing', !!n);
      if (id !== hover) { hover = id; redraw(); }
    },
    grab: () => { $('hint').hidden = true; },
  });
  const { cam, flyTo, zoomAt, panBy, center: viewCenter, clamp: clampCam, sync: syncGoal } = camera;
  let vw = 0, vh = 0, dpr = 1, fitK = 0.5, S = { l: 0, t: 0, r: 0, b: 0 }, ribGeom = [];
  let selected = null, sel = null, focusKey = null, foc = null, hover = null;

  const PERF = new URLSearchParams(location.search).has('perf');
  const stats = { draws: [], tiles: [], labels: [], reset() { this.draws.length = 0; this.tiles.length = 0; this.labels.length = 0; } };

  let raf = 0;
  let active = true;
  const redraw = () => { if (!raf && active) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  const tiles = new Map(), labelSets = new Map();
  let baseVer = 0, level = null, prevLevel = null, zooming = false, zoomIdle = 0, firstFrame = true, budgetEnd = 0;
  // Evicted tile canvases are reused, so steady zooming and panning allocate nothing for the GC to pause on.
  const pool = [];
  const recycle = c => { if (pool.length < 64 && c.width === Math.round(T * dpr)) pool.push(c); };
  function invalidate() { baseVer++; tiles.forEach(recycle); tiles.clear(); labelSets.clear(); redraw(); }
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
    if ((e.type === 'part' || e.quiet) && !hit) return -1;
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
      if (isStep(n)) continue;
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
        if (!set.has(n.id) || !stOf(n) || isStep(n)) continue;
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

  // One label layer for rest, hover and selection. Labels are placed once per zoom level, never baked into tiles,
  // and drawn crisp each frame. A name tries below its dot, then right, left and above (Imhof's order), stays inside
  // the graph, and is left out where every spot is taken.
  const LH = 15;
  function spot(c, x, y, r, w) {
    return c === 0 ? [x - w / 2, y + r + 4] : c === 1 ? [x + r + 6, y - LH / 2] : c === 2 ? [x - r - 6 - w, y - LH / 2] : [x - w / 2, y - r - 4 - LH];
  }
  const inside = (lx, w, left, right) => Math.min(Math.max(lx, left + 2), right - w - 2);
  function placeLabels(list, z, limit = Infinity) {
    // Placed for this zoom (in eighths of an octave); a little padding covers the rest of that eighth.
    const kp = 2 ** z, rs = sizeAt(kp), grid = new Map(), C = 64, out = [];
    const cells = (b, f) => {
      for (let i = Math.floor(b[0] / C); i <= Math.floor((b[0] + b[2]) / C); i++) for (let j = Math.floor(b[1] / C); j <= Math.floor((b[1] + b[3]) / C); j++) if (f(i * 65536 + j) === false) return false;
      return true;
    };
    const clear = b => cells(b, key => (grid.get(key) || []).every(r => b[0] >= r[0] + r[2] || b[0] + b[2] <= r[0] || b[1] >= r[1] + r[3] || b[1] + b[3] <= r[1]));
    for (const n of list) {
      const x = n.x * kp, y = n.y * kp, r = n.r * rs;
      cells([x - r, y - r, 2 * r, 2 * r], key => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push([x - r, y - r, 2 * r, 2 * r]); });
    }
    for (const n of list) {
      if (out.length >= limit) break;
      const w = labelWidth(n.label), x = n.x * kp, y = n.y * kp, r = n.r * rs;
      // Story steps keep their names under the track, where the arcs above cannot reach them.
      for (let c = 0; c < (n.kind === 'story' ? 1 : 4); c++) {
        const [lx0, ly] = spot(c, x, y, r, w), lx = inside(lx0, w, 0, WW * kp), b = [lx - 5, ly, w + 10, LH];
        if (!clear(b)) continue;
        cells(b, key => { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(b); });
        out.push({ n, c, w });
        break;
      }
    }
    return out;
  }
  function labelSet(z) {
    let set = labelSets.get(z);
    if (set) return set;
    const t0 = PERF ? performance.now() : 0;
    const shown = BY_DEG.filter(n => nodeShown(n) && nodeBaseState(n) && !isStep(n));
    set = placeLabels([...shown.filter(n => nodeBaseState(n) === 2), ...shown.filter(n => nodeBaseState(n) === 1)], z, 2 ** z < 0.2 ? 40 : Infinity);
    set.forEach(L => { L.dim = !!foc && nodeBaseState(L.n) === 1; });
    labelSets.set(z, set);
    if (PERF) stats.labels.push(performance.now() - t0);
    return set;
  }
  let selLabels = null;
  function selLabelSet(z) {
    const key = `${baseVer}|${selected}|${z}`;
    if (selLabels && selLabels.key === key) return selLabels.set;
    const list = [...new Set([selected, ...sel.nodes, ...sel.ancN])].map(i => N[i]).filter(m => nodeShown(m) && !isStep(m));
    const set = placeLabels(list.sort((a, b) => (b.id === selected) - (a.id === selected) || DEG[b.id] - DEG[a.id]), z);
    selLabels = { key, set };
    return set;
  }

  let labelZoom = null;
  function drawLabels(X, Y) {
    if (level === null) return;
    // Held through a zoom gesture, so names do not reshuffle mid-pinch.
    if (!zooming || labelZoom === null) labelZoom = Math.round(Math.log2(cam.k) * 8) / 8;
    if (labelSets.size > 12) labelSets.clear();
    const rs = sizeAt(cam.k), left = X(0), right = X(WW);
    ctx.font = LABEL_FONT; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    const at = L => {
      const n = L.n, [lx0, ly] = spot(L.c, X(n.x), Y(n.y), n.r * rs, L.w);
      return [inside(lx0, L.w, left, right), ly];
    };
    const set = sel ? selLabelSet(labelZoom) : labelSet(labelZoom);
    let hov = null;
    if (hover && nodeShown(N[hover]) && !isStep(N[hover])) hov = set.find(L => L.n.id === hover) || { n: N[hover], c: 0, w: labelWidth(N[hover].label) };
    const hb = hov && (([x, y]) => [x - 4, y - 2, hov.w + 8, LH + 4])(at(hov));
    for (const L of set) {
      if (L === hov) continue;
      const [x, y] = at(L);
      if (x > vw || x + L.w < 0 || y > vh || y + LH < 0) continue;
      // The hovered name wins its spot; names it would cover step aside for the frame.
      if (hb && x < hb[0] + hb[2] && x + L.w > hb[0] && y < hb[1] + hb[3] && y + LH > hb[1]) continue;
      paintLabel(ctx, L.n.label, x, y, L.n.id === selected ? PAL.gold : L.dim ? PAL.dim : PAL.star);
    }
    if (hov) { const [x, y] = at(hov); paintLabel(ctx, hov.n.label, x, y, PAL.gold); }
  }

  function renderTile(z, tx, ty) {
    const t0 = PERF ? performance.now() : 0;
    const kz = 2 ** z, ws = T / kz, x0 = tx * ws, y0 = ty * ws, x1 = x0 + ws, y1 = y0 + ws;
    const px = Math.round(T * dpr);
    const c = pool.pop() || Object.assign(document.createElement('canvas'), { width: px, height: px });
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
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
    if (tiles.size > MAX_TILES) {
      const oldest = tiles.keys().next().value;
      recycle(tiles.get(oldest));
      tiles.delete(oldest);
    }
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
  // While idle, finish the ring around the view so the next pan finds tiles ready.
  let prefetchJob = 0;
  const idleCb = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
  function prefetch() {
    if (prefetchJob || level === null) return;
    prefetchJob = idleCb(dl => {
      prefetchJob = 0;
      if (zooming || !camera.idle()) return;
      // Short slices, so input arriving during idle work is never held back.
      // One ring only: a wider one outgrows the tile cache and evicts the visible tiles.
      const [tx0, tx1, ty0, ty1] = tileRange(level, 1), end = performance.now() + Math.min(6, Math.max(2, dl.timeRemaining() - 1));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (!getTile(level, tx, ty, end)) { setTimeout(prefetch, 40); return; }
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
    // Shaded by age, so both parts of Kali share a shade around History.
    const ages = [...new Set(BANDS.map(b => b.period))];
    BANDS.forEach(b => { if (ages.indexOf(b.period) % 2 === 0) ctx.fillRect(0, Y(b.y0), vw, (b.y1 - b.y0) * k); });
    // A bracket in the margin spans an age split around another band.
    for (const p of ages) {
      const parts = BANDS.filter(b => b.period === p);
      if (parts.length < 2) continue;
      const bx = Math.max(S.l + 6, X(0) + 6), top = Y(parts[0].y0) + 40, bottom = Y(parts[parts.length - 1].y1) - 30;
      ctx.fillStyle = PAL.gold; ctx.globalAlpha = 0.5;
      ctx.fillRect(bx, top, 2, bottom - top); ctx.fillRect(bx, top, 10, 2); ctx.fillRect(bx, bottom - 2, 10, 2);
      ctx.globalAlpha = 1; ctx.fillStyle = PAL.band;
    }
    ctx.fillStyle = PAL.rule; ctx.fillRect(Math.round(X(RAIL.x0)), Y(0), 1, WH * k);    const want = levelFor(k);
    if (level === null) level = want;
    else if (want !== level && (!zooming || Math.abs(want - level) >= 1.5)) { prevLevel = level; level = want; }
    if (prevLevel !== null) drawLevel(prevLevel, 0);
    // Draws landing in the same frame share one tile budget.
    const now = performance.now();
    if (now > budgetEnd + 8) budgetEnd = now + FRAME_BUDGET;
    const deadline = firstFrame ? Infinity : budgetEnd;
    const complete = drawLevel(level, deadline);
    firstFrame = false;
    if (complete) {
      // This frame still shows the old level underneath; one more frame drops it.
      if (prevLevel !== null) { prevLevel = null; redraw(); }
      aheadOf(deadline); prefetch();
    } else redraw();
    drawOverlay(X, Y);
    drawBandNames(X, Y);
    updateRibbon();
    if (PERF) stats.draws.push(performance.now() - t0);
  }

  function drawOverlay(X, Y) {
    const k = cam.k, rs = sizeAt(k), P = (x, y) => [X(x), Y(y)];
    if (sel) {
      ctx.globalAlpha = 0.8; ctx.fillStyle = PAL.night; ctx.fillRect(0, 0, vw, vh); ctx.globalAlpha = 1;
      const buckets = new Map();
      for (const i of new Set([...sel.edges, ...sel.ancE])) {
        if (isStep(N[EDGES[i].f]) || isStep(N[EDGES[i].t])) continue;
        const e = EDGES[i], key = `${sel.ancE.has(i) ? 4 : 3}|${e.type}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(e);
      }
      paintEdges(ctx, buckets, P, 1, Math.min(1.6, Math.max(0.7, k)));
      const list = [...new Set([selected, ...sel.nodes, ...sel.ancN])].map(i => N[i]).filter(nodeShown);
      paintNodes(ctx, list, () => 2, P, 1, rs, true);
      const n = N[selected];
      if (isStep(n)) ringPeople(n.id, P, rs);
      else {
        const [x, y] = P(n.x, n.y);
        ctx.beginPath(); ctx.arc(x, y, n.r * rs + 7, 0, Math.PI * 2);
        ctx.strokeStyle = PAL.gold; ctx.lineWidth = 2.2; ctx.stroke();
      }
    }
    if (hover && hover !== selected && nodeShown(N[hover]) && isStep(N[hover])) ringPeople(hover, P, rs);
    else if (hover && hover !== selected && nodeShown(N[hover])) {
      const n = N[hover], [x, y] = P(n.x, n.y);
      ctx.beginPath(); ctx.arc(x, y, n.r * rs + 5, 0, Math.PI * 2);
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.6; ctx.stroke();
    }
    drawLabels(X, Y);
  }

  // The people in a story step, ringed in gold.
  function ringPeople(id, P, rs) {
    ctx.beginPath();
    for (const e of EDGES) {
      if (e.f !== id && e.t !== id) continue;
      const m = N[e.f === id ? e.t : e.f];
      if (isStep(m) || !nodeShown(m)) continue;
      const [x, y] = P(m.x, m.y), r = m.r * rs + 5;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.8; ctx.stroke();
  }

  function drawBandNames(X, Y) {
    ctx.textBaseline = 'alphabetic';
    BANDS.forEach(b => {
      const y0 = Y(b.y0), y1 = Y(b.y1);
      if (y1 < S.t || y0 > vh) return;
      // Names live in the empty head of each band; when that shrinks on zoom-out, so does the name.
      const roomy = HEAD * cam.k >= 96;
      const y = roomy ? y0 + 54 : y0 + Math.max(16, HEAD * cam.k * 0.6);
      const x = Math.max(S.l + 18, X(0) + 18);
      ctx.font = roomy ? BAND_FONT : '400 18px "Tiro Devanagari Sanskrit", Georgia, serif';
      ctx.fillStyle = PAL.star; ctx.globalAlpha = 0.85;
      ctx.fillText(b.name, x, y);
      ctx.globalAlpha = 1;
      // Year ranges label the rows of a band laid out by date, once rows are far enough apart to read.
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
    btn.innerHTML = `<span>${b.tab || b.name.replace(' Yuga', '')}</span>`;
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
    // The reading line slides from the view's top to its bottom as the graph scrolls from start to end,
    // so the first band is current at the top and the last at the very end, however short it is.
    const viewTop = (S.t - cam.y) / cam.k, viewH = (vh - S.b - S.t) / cam.k, room = WH - viewH;
    const wy = viewTop + (room > 0 ? Math.min(1, Math.max(0, viewTop / room)) : 0.5) * viewH;
    let at = BANDS.findIndex(b => wy < b.y1);
    if (at < 0) at = BANDS.length - 1;
    if (at !== ribAt) { ribAt = at; ribbonBtns.forEach((b, i) => b.setAttribute('aria-current', String(i === at))); }
    const b = BANDS[at], [top, height] = ribGeom[at] || [0, 0];
    const f = Math.min(1, Math.max(0, (wy - b.y0) / (b.y1 - b.y0)));
    here.style.transform = `translateY(${top + f * (height - 2)}px)`;
  }

  function resize() {
    const d = Math.min(2, devicePixelRatio || 1);
    if (d !== dpr) { dpr = d; tiles.clear(); pool.length = 0; }
    vw = innerWidth; vh = innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    const wide = vw > 760;
    S = { l: ribbon.offsetWidth, t: header.offsetHeight, r: wide && !panel.hidden ? 412 : 0, b: !wide && !panel.hidden ? panel.offsetHeight : 0 };
    ribGeom = ribbonBtns.map(b => [b.offsetTop, b.offsetHeight]);
    fitK = (vw - S.l - S.r - 24) / WW;
    redraw();
  }
  function fit(animate = true) {
    const k = fitK, x = S.l + (vw - S.l - S.r - WW * k) / 2, y = S.t + 8;
    if (animate) flyTo(x, y, k); else camera.set(x, y, k);
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
        if (!nodeShown(n) || isStep(n)) continue;
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < rad + n.r && d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }


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
      <div class="tags"><span class="tag age">${age}</span>${KIND_TAG[n.kind] && n.yuga !== 'deva' ? `<span class="tag">${KIND_TAG[n.kind]}</span>` : ''}${n.yuga !== 'deva' && n.tier && n.tier !== 'history' ? `<span class="tag">${TIER_TAG[n.tier]}</span>` : ''}${CHIRANJIVI.has(id) ? '<span class="tag">Chiranjivi</span>' : n.span ? '<span class="tag">Lives across ages</span>' : ''}${CATASTROPHES.has(id) ? '<span class="tag">Catastrophe</span>' : ''}${n.years ? `<span class="tag">${fmtYears(n.years)}</span>` : ''}</div>
      <p>${n.desc}</p>
      ${(model.placesOf[id] || []).length ? `<h3>Places</h3><ul class="places">${model.placesOf[id].map(a => {
        const p = model.PLACES[a.where];
        return `<li>${PLACE_VERB[a.does]} <b>${p.label}</b>${IDENT_NOTE[p.identification] ? `<span class="how">${IDENT_NOTE[p.identification]}</span>` : ''}</li>`;
      }).join('')}</ul>` : ''}
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
    if (open) closeStories();
  };
  document.addEventListener('pointerdown', ev => {
    if (!filters.hidden && !filters.contains(ev.target) && ev.target !== filtersBtn) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); }
  });

  // Stories: an age's steps in reading order; hovering one rings its people, picking it selects it and flies there.
  const storiesBtn = $('storiesBtn'), stories = $('stories'), storyAges = $('storyAges'), storySteps = $('storySteps');
  const told = BANDS.filter(b => b.stories && b.stories.length);
  let storyAge = told[0]?.period;
  function renderStories() {
    storyAges.innerHTML = told.map(b => `<button type="button" role="tab" aria-checked="${b.period === storyAge}" data-age="${b.period}">${b.tab || b.name.replace(' Yuga', '')}</button>`).join('');
    const b = told.find(t => t.period === storyAge);
    storySteps.innerHTML = b.stories.filter(id => nodeShown(N[id])).map((id, i) =>
      `<li><button type="button" data-step="${id}"${id === selected ? ' aria-current="true"' : ''}><span class="i">${i + 1}</span><span>${N[id].label}</span><span class="d">${N[id].desc}</span></button></li>`).join('');
  }
  function closeStories() { stories.hidden = true; storiesBtn.setAttribute('aria-expanded', 'false'); }
  storiesBtn.onclick = () => {
    const open = stories.hidden;
    if (open) {
      const at = BANDS.find(b => (viewCenter()[1] - cam.y) / cam.k < b.y1);
      if (at && told.includes(at)) storyAge = at.period;
      renderStories();
      filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false');
    }
    stories.hidden = !open;
    storiesBtn.setAttribute('aria-expanded', String(open));
  };
  storyAges.addEventListener('click', ev => { const b = ev.target.closest('[data-age]'); if (b) { storyAge = b.dataset.age; renderStories(); } });
  storySteps.addEventListener('click', ev => { const b = ev.target.closest('[data-step]'); if (b) { select(b.dataset.step, true); renderStories(); } });
  storySteps.addEventListener('pointerover', ev => { const b = ev.target.closest('[data-step]'); const id = b ? b.dataset.step : null; if (id !== hover) { hover = id; redraw(); } });
  storySteps.addEventListener('pointerleave', () => { hover = null; redraw(); });
  document.addEventListener('pointerdown', ev => {
    if (!stories.hidden && !stories.contains(ev.target) && ev.target !== storiesBtn && !panel.contains(ev.target)) closeStories();
  });

  const qIn = $('q'), qRes = $('qres');
  let qHits = [], qAt = -1;
  const placeOf = n => n.yuga === 'deva' ? 'The gods' : BANDS.find(b => b.period === n.yuga).name;
  function qClose() { qRes.hidden = true; qIn.setAttribute('aria-expanded', 'false'); qIn.removeAttribute('aria-activedescendant'); qAt = -1; }
  function qPick(n) {
    qClose(); qIn.value = ''; qIn.blur();
    if (location.hash === '#map') location.hash = '#graph';
    select(n.id, true);
  }
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
    if (!active || ev.target.closest('input')) return;
    const [cx, cy] = viewCenter();
    if (ev.key === '/') { ev.preventDefault(); qIn.focus(); }
    else if (ev.key === 'Escape') {
      if (!filters.hidden) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); }
      else if (!stories.hidden) closeStories();
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

  addEventListener('resize', () => { resize(); clampCam(); syncGoal(); });
  if (document.fonts) document.fonts.ready.then(() => { widthCache.clear(); invalidate(); });

  const view = {
    // Called once the palette is read, and again whenever the theme changes.
    themeChanged() {
      linkChips.querySelectorAll('[data-c]').forEach(s => { s.style.background = edgeColor(s.dataset.c); });
      invalidate();
    },
    start() { resize(); updateCounts(); fit(false); },
    show(on) {
      active = on;
      cv.hidden = !on;
      panel.hidden = !on || !selected;
      if (!on) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); closeStories(); return; }
      resize();
    },
    open(id) { select(id, true); },
    zoom(f) { zoomAt(...viewCenter(), f); },
    fit,
    state: () => ({ x: cam.x, y: cam.y, k: cam.k, selected }),
    restore(s) {
      camera.set(s.x, s.y, s.k);
      if (s.selected && N[s.selected]) select(s.selected, false);
    },
  };
  if (PERF) window.__aoa = { cam, stats, select, idle: () => camera.idle() && !zooming, tileState: () => ({ level, prevLevel, tiles: tiles.size, zooming }) };
  return view;
}
