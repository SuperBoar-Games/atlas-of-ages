'use strict';

const { W: WW, H: WH, head: HEAD, bands: BANDS, rail: RAIL } = DATA.layout;
const NODES = DATA.nodes;
const N = Object.fromEntries(NODES.map(n => [n.id, n]));

// Curve side comes from the link's identity, so adding a link never flips the others.
const sideOf = k => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) | 0; return h & 1 ? 1 : -1; };
const EDGES = DATA.edges.map((e, i) => ({ ...e, i, later: e.own === 'purana' || e.own === 'folk', side: sideOf(`${e.f}>${e.t}>${e.type}`) }));

const TIER_RANK = { core: 0, layer: 1, vulgate: 2, purana: 3, folk: 4 };
const RANKED = ['core', 'layer', 'vulgate', 'purana', 'folk'];
const YORD = { origins: -1, satya: 0, treta: 1, dvapara: 2, kali: 3 };
const YNAME = { origins: 'Origins', satya: 'Satya', treta: 'Treta', dvapara: 'Dvapara', kali: 'Kali' };

const TYPES = {
  line: { label: 'Lineage', fwd: 'Parent of', rev: 'Child of' },
  gap: { label: 'Many generations', fwd: 'Ancestor of', rev: 'Descendant of', group: 'line', dash: [2, 5] },
  bond: { label: 'Marriage and kin', fwd: 'Related to', rev: 'Related to', group: 'line', dash: [3, 3] },
  reborn: { label: 'Rebirth', fwd: 'Reborn as', rev: 'Previous life', dash: [1, 4] },
  cross: { label: 'Crossings', fwd: 'Linked with', rev: 'Linked with', dash: [7, 4] },
  kill: { label: 'Slayings', fwd: 'Kills', rev: 'Killed by' },
  deva: { label: 'Divine origin', fwd: 'Divine father of', rev: 'Son of' },
  tell: { label: 'Narration', fwd: 'Tells', rev: 'Hears', dash: [10, 3, 2, 3] },
  reign: { label: 'Rule and succession', fwd: 'Succeeded by', rev: 'Succeeds' },
  story: { label: 'Storylines', fwd: 'Leads to', rev: 'Follows' },
  meet: { label: 'Storylines meet', fwd: 'Meets', rev: 'Meets', group: 'story', dash: [6, 4] },
  part: { label: 'Takes part', fwd: 'Involves', rev: 'Takes part in', group: 'story' }
};
const FILTERS = ['line', 'reborn', 'cross', 'kill', 'reign', 'deva', 'tell', 'story'];
const groupOf = t => TYPES[t].group || t;
// Links spanning more than this (world units, vertically) are faded until selected.
const FAR = 700;
const STRAIGHT = new Set(['line', 'gap', 'bond', 'story', 'reign', 'meet']);
const ORDER = { line: 0, gap: 0, bond: 1, deva: 2, reborn: 3, reign: 4, story: 5, meet: 5, part: 6, cross: 7, kill: 8, tell: 9 };
const TIER_TAG = { core: 'Critical text', layer: 'Critical text, later layer', vulgate: 'Popular versions only', purana: 'Purana or later work', folk: 'Folk or other tradition', history: 'Recorded history' };
const TIER_NOTE = { layer: ', later layer', vulgate: ', popular versions only', purana: ', Purana', folk: ', folk or other' };
const KIND_TAG = { story: 'Storyline', event: 'Event', avatar: 'Avatar', sage: 'Sage', deva: 'God' };

// A link is no more canonical than either of its ends.
EDGES.forEach(e => {
  const a = N[e.f], b = N[e.t];
  e.tier = (a.tier === 'history' || b.tier === 'history') ? 'history'
    : RANKED[Math.max(TIER_RANK[e.own], TIER_RANK[a.tier] || 0, TIER_RANK[b.tier] || 0)];
  e.xy = !['line', 'gap', 'deva', 'story'].includes(e.type) && a.yuga in YORD && b.yuga in YORD && a.yuga !== b.yuga;
  if (!STRAIGHT.has(e.type)) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(180, len * 0.16) * e.side * (e.type === 'part' ? 0.5 : 1);
    e.cx = (a.x + b.x) / 2 - dy / len * bend;
    e.cy = (a.y + b.y) / 2 + dx / len * bend;
  }
  e.bx0 = Math.min(a.x, b.x, e.cx ?? a.x); e.bx1 = Math.max(a.x, b.x, e.cx ?? a.x);
  e.by0 = Math.min(a.y, b.y, e.cy ?? a.y); e.by1 = Math.max(a.y, b.y, e.cy ?? a.y);
});

const DEG = Object.fromEntries(NODES.map(n => [n.id, 0]));
EDGES.forEach(e => { if (e.type !== 'part') { DEG[e.f]++; DEG[e.t]++; } });
NODES.forEach(n => { n.r = 2.6 + Math.sqrt(DEG[n.id]) * 0.85; });
const BY_DEG = [...NODES].sort((a, b) => DEG[b.id] - DEG[a.id]);

const CHIRANJIVI = new Set(NODES.filter(n => n.chiranjivi).map(n => n.id));
const CATASTROPHES = new Set(NODES.filter(n => n.catastrophe).map(n => n.id));

// Avatars and incarnations: Vishnu's avatars plus every figure a god is born into, wholly or in part.
const INCARN = (() => {
  const nodes = new Set(NODES.filter(n => n.kind === 'avatar').map(n => n.id)), edges = new Set(), sources = new Set();
  const re = /incarnat|avatar|born in part|takes the form|appears as|is born as|born on earth as|reborn as|form of/i;
  EDGES.forEach(e => {
    const src = N[e.f];
    const divine = src.kind === 'deva' || src.kind === 'avatar' || src.yuga === 'deva' || ['sanaka', 'kalidemon', 'brihaspati'].includes(e.f);
    if ((e.type === 'deva' && re.test(e.l || '')) || (e.type === 'reborn' && divine)) { nodes.add(e.t); edges.add(e.i); sources.add(e.f); }
  });
  return { nodes, edges, sources };
})();

const BEINGS = [
  ['god', 'Devas and avatars'], ['asura', 'Asuras'], ['rakshasa', 'Rakshasas'], ['naga', 'Nagas'], ['yaksha', 'Yakshas'],
  ['gandharva', 'Gandharvas'], ['apsara', 'Apsaras'], ['vanara', 'Vanaras'], ['riksha', 'Rikshas'],
  ['beast', 'Divine birds and beasts'], ['sage', 'Rishis and sages'], ['human', 'Humans']
].map(([k, label]) => [`b_${k}`, label, n => n.being === k]);
const ROLES = [
  ['r_avatar', 'Avatars and incarnations', n => INCARN.nodes.has(n.id)],
  ['r_king', 'Kings', n => n.roles.includes('king')],
  ['r_women', 'Women and goddesses', n => n.roles.includes('women')],
  ['r_event', 'Events and storylines', n => (n.kind === 'event' || n.kind === 'story') && n.yuga !== 'history'],
  ['r_history', 'Recorded history', n => n.yuga === 'history']
];
const MARKS = [
  ['chiranjivi', 'Chiranjivis', n => CHIRANJIVI.has(n.id)],
  ['span', 'Live across ages', n => n.span],
  ['cat', 'Catastrophes', n => CATASTROPHES.has(n.id)],
  ['cross', 'Links between ages', null],
  ['layer', 'Later layers', n => n.tier === 'layer'],
  ['vulgate', 'Popular versions only', null],
  ['purana', 'Puranas', n => n.tier === 'purana'],
  ['folk', 'Folk and other traditions', n => n.tier === 'folk']
];
const FOCUS = Object.fromEntries([...MARKS, ...BEINGS, ...ROLES].map(([k, , f]) => [k, f]));
const TIER_KEYS = new Set(RANKED);

const off = new Set();
let srcLevel = 4;
const nodeShown = n => n.tier === 'history' || TIER_RANK[n.tier] <= srcLevel;
const visible = e => !off.has(groupOf(e.type)) && (e.tier === 'history' || TIER_RANK[e.tier] <= srcLevel) && nodeShown(N[e.f]) && nodeShown(N[e.t]);

function focusSets(k) {
  const nodes = new Set(), near = new Set(), edges = new Set();
  if (k === 'cross') {
    EDGES.forEach(e => { if (e.xy && visible(e)) { edges.add(e.i); nodes.add(e.f); nodes.add(e.t); } });
  } else if (k === 'r_avatar') {
    INCARN.nodes.forEach(i => nodes.add(i));
    INCARN.edges.forEach(i => { if (visible(EDGES[i])) edges.add(i); });
    INCARN.sources.forEach(i => { if (!nodes.has(i)) near.add(i); });
  } else {
    if (FOCUS[k]) NODES.forEach(n => { if (nodeShown(n) && FOCUS[k](n)) nodes.add(n.id); });
    EDGES.forEach(e => {
      if (!visible(e) || e.type === 'part') return;
      const hit = TIER_KEYS.has(k) ? e.tier === k : nodes.has(e.f) || nodes.has(e.t);
      if (hit) { edges.add(e.i); [e.f, e.t].forEach(i => { if (!nodes.has(i)) near.add(i); }); }
    });
  }
  return { nodes, near, edges };
}

function ancestry(id) {
  const nodes = new Set(), edges = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    EDGES.forEach(e => {
      if (e.t === cur && (e.type === 'line' || e.type === 'gap') && !e.later && !N[e.f].later && !edges.has(e.i) && visible(e)) {
        edges.add(e.i);
        if (!nodes.has(e.f)) { nodes.add(e.f); stack.push(e.f); }
      }
    });
  }
  return { nodes, edges };
}
const relation = (e, id) => e.f === id ? (e.l || TYPES[e.type].fwd) : (e.r || TYPES[e.type].rev);

// Spatial grid for hit testing.
const CELL = 120, GRID = new Map();
NODES.forEach(n => {
  const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
  if (!GRID.has(k)) GRID.set(k, []);
  GRID.get(k).push(n);
});

const cv = document.getElementById('sky'), ctx = cv.getContext('2d');
const panel = document.getElementById('panel'), ribbon = document.getElementById('ribbon'), header = document.querySelector('.top');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const cam = { x: 0, y: 0, k: 1 };
let vw = 0, vh = 0, dpr = 1, PAL = {}, fitK = 0.5;
let selected = null, sel = null, focusKey = null, foc = null, hover = null;

const PAL_KEYS = ['night', 'band', 'star', 'dim', 'rule', 'gold', 'l-line', 'l-reborn', 'l-cross', 'l-kill', 'l-deva', 'l-tell', 'l-reign', 'l-story',
  'k-person', 'k-sage', 'k-avatar', 'k-deva', 'k-event', 'k-story'];
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  PAL_KEYS.forEach(k => { PAL[k] = cs.getPropertyValue('--' + k).trim(); });
  PAL.kill = PAL['l-kill'];
}
const edgeColor = t => PAL['l-' + groupOf(t)];
const nodeColor = n => PAL['k-' + n.kind] || PAL['k-person'];

const insets = () => S;

let raf = 0;
const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

// The graph is drawn into cached tiles per zoom level, as map engines do: panning only moves bitmaps,
// zooming scales them until the gesture rests, and the selection is painted as a live overlay on top.
const T = 256, MAX_TILES = 220, FRAME_BUDGET = 3;
const tiles = new Map(), labelSets = new Map();
let baseVer = 0, level = null, prevLevel = null, zooming = false, zoomIdle = 0, firstFrame = true;
function invalidate() { baseVer++; tiles.clear(); labelSets.clear(); redraw(); }
function zoomMotion() {
  zooming = true;
  clearTimeout(zoomIdle);
  zoomIdle = setTimeout(() => { zooming = false; redraw(); }, 160);
}
const levelFor = k => Math.round(Math.log2(k) * 2) / 2;
const sizeAt = k => Math.min(1.5, Math.max(0.6, Math.sqrt(k)));

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
  const kz = 2 ** z, ws = T / kz, x0 = tx * ws, y0 = ty * ws, x1 = x0 + ws, y1 = y0 + ws;
  const px = Math.round(T * dpr);
  const c = Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = c.getContext('2d');
  g.setTransform(dpr * kz, 0, 0, dpr * kz, -x0 * kz * dpr, -y0 * kz * dpr);
  g.fillStyle = PAL.night; g.fillRect(x0, y0, ws, ws);
  g.fillStyle = PAL.band;
  BANDS.forEach((b, i) => { if (i % 2 === 0 && b.y1 > y0 && b.y0 < y1) g.fillRect(0, b.y0, RAIL.x0, b.y1 - b.y0); });
  g.fillRect(RAIL.x0, 0, RAIL.x1 - RAIL.x0, WH);

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

let S = { l: 0, t: 0, r: 0, b: 0 }, ribGeom = [];
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

function clampCam() {
  const s = insets();
  cam.k = Math.min(3, Math.max(fitK * 0.5, cam.k));
  const minX = vw - s.r - 40 - WW * cam.k, maxX = s.l + 40;
  cam.x = minX > maxX ? (s.l + vw - s.r - WW * cam.k) / 2 : Math.min(maxX, Math.max(minX, cam.x));
  cam.y = Math.min(s.t + 40, Math.max(vh - s.b - 80 - WH * cam.k, cam.y));
}

let anim = null;
function flyTo(x, y, k) {
  const from = { ...cam }, t0 = performance.now(), dur = reduced.matches ? 0 : 420;
  cancelAnimationFrame(anim);
  const step = now => {
    const p = dur ? Math.min(1, (now - t0) / dur) : 1, q = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    cam.x = from.x + (x - from.x) * q; cam.y = from.y + (y - from.y) * q; cam.k = from.k + (k - from.k) * q;
    if (p < 1 && from.k !== k) zoomMotion();
    draw();
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function fit(animate = true) {
  const s = insets(), k = fitK;
  const x = s.l + (vw - s.l - s.r - WW * k) / 2, y = s.t + 8;
  if (animate) flyTo(x, y, k); else { cam.x = x; cam.y = y; cam.k = k; redraw(); }
}
function centerOn(n) {
  const s = insets(), k = Math.max(cam.k, 0.85);
  flyTo(s.l + (vw - s.l - s.r) / 2 - n.x * k, s.t + (vh - s.t - s.b) / 2 - n.y * k, k);
}
function zoomAt(sx, sy, f) {
  const k = Math.min(3, Math.max(fitK * 0.5, cam.k * f));
  cam.x = sx - (sx - cam.x) * (k / cam.k); cam.y = sy - (sy - cam.y) * (k / cam.k); cam.k = k;
  clampCam(); zoomMotion(); redraw();
}

const LABEL_FONT = '500 12.5px "Hanken Grotesk", system-ui, sans-serif';
const BAND_FONT = '400 30px "Tiro Devanagari Sanskrit", Georgia, serif';
const widthCache = new Map();
function labelWidth(t) {
  let w = widthCache.get(t);
  if (w === undefined) { ctx.font = LABEL_FONT; w = ctx.measureText(t).width; widthCache.set(t, w); }
  return w;
}

function draw() {
  const k = cam.k, X = x => x * k + cam.x, Y = y => y * k + cam.y;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.night; ctx.fillRect(0, 0, vw, vh);
  const want = levelFor(k);
  if (level === null) level = want;
  else if (want !== level && (!zooming || Math.abs(want - level) >= 1.5)) { prevLevel = level; level = want; }
  if (prevLevel !== null) drawLevel(prevLevel, 0);
  const deadline = firstFrame ? Infinity : performance.now() + FRAME_BUDGET;
  const complete = drawLevel(level, deadline);
  firstFrame = false;
  if (complete) { prevLevel = null; aheadOf(deadline); prefetch(); } else redraw();
  drawOverlay(X, Y);
  drawBandNames(X, Y, S);
  updateRibbon(S);
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

function drawBandNames(X, Y, s) {
  ctx.textBaseline = 'alphabetic';
  BANDS.forEach(b => {
    const y0 = Y(b.y0), y1 = Y(b.y1);
    if (y1 < s.t || y0 > vh) return;
    // Names live in the empty head of each band; when that shrinks on zoom-out, so does the name.
    const roomy = HEAD * cam.k >= 96;
    const y = roomy ? Math.min(y1 - 30, Math.max(y0 + 54, s.t + 46)) : y0 + Math.max(16, HEAD * cam.k * 0.6);
    const x = Math.max(s.l + 18, X(0) + 18);
    ctx.font = roomy ? BAND_FONT : '400 18px "Tiro Devanagari Sanskrit", Georgia, serif';
    ctx.fillStyle = PAL.star; ctx.globalAlpha = 0.85;
    ctx.fillText(b.name, x, y);
    ctx.globalAlpha = 1;
    if (!roomy) return;
    ctx.font = '400 13.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.fillStyle = PAL.dim;
    ctx.fillText(b.note, x, y + 22);
  });
  const rx = X((RAIL.x0 + RAIL.x1) / 2);
  if (rx > s.l && rx < vw) {
    ctx.font = '400 20px "Tiro Devanagari Sanskrit", Georgia, serif'; ctx.fillStyle = PAL.star; ctx.globalAlpha = .85; ctx.textAlign = 'center';
    ctx.fillText(RAIL.name, rx, Math.max(s.t + 30, Y(0) + 40));
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
  btn.onclick = () => { const s = insets(); flyTo(cam.x, s.t + 10 - b.y0 * cam.k, cam.k); };
  ribbon.appendChild(btn);
  return btn;
});
const here = document.createElement('div');
here.className = 'here';
ribbon.appendChild(here);
let ribAt = -1;
function updateRibbon(s) {
  const wy = ((s.t + vh - s.b) / 2 - cam.y) / cam.k;
  let at = BANDS.findIndex(b => wy < b.y1);
  if (at < 0) at = BANDS.length - 1;
  if (at !== ribAt) { ribAt = at; ribbonBtns.forEach((b, i) => b.setAttribute('aria-current', String(i === at))); }
  const b = BANDS[at], [top, height] = ribGeom[at] || [0, 0];
  const f = Math.min(1, Math.max(0, (wy - b.y0) / (b.y1 - b.y0)));
  here.style.transform = `translateY(${top + f * (height - 2)}px)`;
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
  document.getElementById('hint').hidden = true;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gesture = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, moved: true };
  } else gesture = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false };
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
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.k * d / gesture.d / cam.k);
    return;
  }
  const dx = ev.clientX - gesture.x, dy = ev.clientY - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) > 4) { gesture.moved = true; cv.classList.add('dragging'); }
  if (gesture.moved && !gesture.pinch) { cam.x = gesture.cx + dx; cam.y = gesture.cy + dy; clampCam(); redraw(); }
});
const endPointer = ev => {
  if (!ptrs.has(ev.pointerId)) return;
  ptrs.delete(ev.pointerId);
  cv.classList.remove('dragging');
  if (ev.type === 'pointerup' && gesture && !gesture.moved && ptrs.size === 0) {
    const n = hit(ev.clientX, ev.clientY);
    if (n) select(n.id, false); else if (selected) select(null); else if (focusKey) setFocus(focusKey);
  }
  if (ptrs.size === 0) gesture = null;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { if (hover && !ptrs.size) { hover = null; cv.classList.remove('pointing'); redraw(); } });
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  cancelAnimationFrame(anim);
  // Ctrl+wheel is a trackpad pinch; a mouse wheel moves in coarse steps; anything else is a two-finger pan.
  const mouseWheel = ev.deltaMode !== 0 || (ev.deltaX === 0 && Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) >= 50);
  if (ev.ctrlKey || mouseWheel) zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : 0.0018) * (ev.deltaMode === 1 ? 33 : 1)));
  else { cam.x -= ev.deltaX; cam.y -= ev.deltaY; clampCam(); redraw(); }
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

const markChips = document.getElementById('markChips'), beingChips = document.getElementById('beingChips'), roleChips = document.getElementById('roleChips');
const chipHTML = list => list.map(([k, label]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="false">${label}<span class="n"></span></button>`).join('');
markChips.innerHTML = chipHTML(MARKS);
beingChips.innerHTML = chipHTML(BEINGS);
roleChips.innerHTML = chipHTML(ROLES);
function updateCounts() {
  document.querySelectorAll('.chip[data-k]').forEach(b => {
    const { nodes, edges } = focusSets(b.dataset.k);
    const c = b.dataset.k === 'vulgate' || b.dataset.k === 'cross' ? edges.size : nodes.size;
    b.hidden = !c;
    b.querySelector('.n').textContent = c;
  });
  const links = EDGES.filter(e => e.type !== 'part' && visible(e)).length;
  document.getElementById('stats').textContent = `${NODES.filter(nodeShown).length} figures and events, ${links} links`;
}
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
document.getElementById('filters').addEventListener('click', ev => {
  const c = ev.target.closest('.chip[data-k]');
  if (c) setFocus(c.dataset.k);
});

const linkChips = document.getElementById('linkChips');
linkChips.innerHTML = FILTERS.map(f => `<button type="button" class="chip toggle" data-f="${f}" aria-pressed="true"><span class="ln" data-c="${f}"></span>${TYPES[f].label}</button>`).join('');
linkChips.addEventListener('click', ev => {
  const c = ev.target.closest('[data-f]');
  if (!c) return;
  const f = c.dataset.f, on = off.has(f);
  if (on) off.delete(f); else off.add(f);
  c.setAttribute('aria-pressed', String(on));
  refilter();
});
const TIER_OPTIONS = ['Critical text only', 'Add later layers', 'Add popular versions', 'Add Puranas', 'Everything'];
const tierSeg = document.getElementById('tierSeg');
tierSeg.innerHTML = TIER_OPTIONS.map((t, i) => `<button type="button" role="radio" data-l="${i}" aria-checked="${i === srcLevel}">${t}</button>`).join('');
tierSeg.addEventListener('click', ev => {
  const b = ev.target.closest('[data-l]');
  if (!b) return;
  srcLevel = +b.dataset.l;
  tierSeg.querySelectorAll('[data-l]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
  refilter();
});
function paintSwatches() {
  linkChips.querySelectorAll('[data-c]').forEach(s => { s.style.background = edgeColor(s.dataset.c); });
}
function refilter() {
  if (selected && !nodeShown(N[selected])) select(null);
  else if (selected) select(selected, false);
  if (focusKey) foc = focusSets(focusKey);
  updateCounts();
  syncFiltersBtn();
  invalidate();
}
const filtersBtn = document.getElementById('filtersBtn'), filters = document.getElementById('filters');
function syncFiltersBtn() { filtersBtn.classList.toggle('on', off.size > 0 || srcLevel < 4 || !!focusKey); }
filtersBtn.onclick = () => {
  const open = filters.hidden;
  filters.hidden = !open;
  filtersBtn.setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', ev => {
  if (!filters.hidden && !filters.contains(ev.target) && ev.target !== filtersBtn) { filters.hidden = true; filtersBtn.setAttribute('aria-expanded', 'false'); }
});

// Search: accent-insensitive, names first, then descriptions.
const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SEARCH = NODES.map(n => ({ n, name: norm(n.label), desc: norm(n.desc) }));
const qIn = document.getElementById('q'), qRes = document.getElementById('qres');
let qHits = [], qAt = -1;
const placeOf = n => n.yuga === 'deva' ? 'The gods' : BANDS.find(b => b.period === n.yuga).name;
function qClose() { qRes.hidden = true; qIn.setAttribute('aria-expanded', 'false'); qIn.removeAttribute('aria-activedescendant'); qAt = -1; }
function qPick(n) { qClose(); qIn.value = ''; qIn.blur(); select(n.id, true); }
function qShow() {
  const q = norm(qIn.value.trim());
  if (!q) { qClose(); return; }
  const scored = [];
  SEARCH.forEach(r => {
    if (!nodeShown(r.n)) return;
    const i = r.name.indexOf(q);
    const s = i === 0 ? 0 : i > 0 ? (/[\s(&,]/.test(r.name[i - 1]) ? 1 : 2) : r.desc.includes(q) ? 3 : -1;
    if (s >= 0) scored.push([s, r.n]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
  qHits = scored.slice(0, 14).map(x => x[1]);
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
  const s = insets(), cx = (s.l + vw - s.r) / 2, cy = (s.t + vh - s.b) / 2;
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
    cam.x += m[0]; cam.y += m[1]; clampCam(); redraw();
  }
});
document.getElementById('zin').onclick = () => { const s = insets(); zoomAt((s.l + vw - s.r) / 2, (s.t + vh - s.b) / 2, 1.3); };
document.getElementById('zout').onclick = () => { const s = insets(); zoomAt((s.l + vw - s.r) / 2, (s.t + vh - s.b) / 2, 1 / 1.3); };
document.getElementById('zfit').onclick = () => fit();

const themeBtn = document.getElementById('themeBtn');
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.setAttribute('aria-pressed', String(t === 'light'));
  readPalette(); paintSwatches(); invalidate();
}
themeBtn.onclick = () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('yc-theme', t); } catch (_) {}
  setTheme(t);
};
let saved = null;
try { saved = localStorage.getItem('yc-theme'); } catch (_) {}
setTheme(saved === 'light' ? 'light' : 'dark');

addEventListener('resize', () => { resize(); clampCam(); });
resize();
updateCounts();
fit(false);
if (document.fonts) document.fonts.ready.then(() => { widthCache.clear(); invalidate(); });
