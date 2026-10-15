// Shared by every view: the graph model (entries, links, tiers, filters, highlights, search) and the camera.

export const TYPES = {
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
export const FILTERS = ['line', 'reborn', 'cross', 'kill', 'reign', 'deva', 'tell', 'story'];
export const groupOf = t => TYPES[t].group || t;
export const TIER_RANK = { core: 0, layer: 1, vulgate: 2, purana: 3, folk: 4 };
export const RANKED = ['core', 'layer', 'vulgate', 'purana', 'folk'];
export const YNAME = { origins: 'Origins', satya: 'Satya', treta: 'Treta', dvapara: 'Dvapara', kali: 'Kali' };
export const ORDER = { line: 0, gap: 0, bond: 1, deva: 2, reborn: 3, reign: 4, story: 5, meet: 5, part: 6, cross: 7, kill: 8, tell: 9 };
export const TIER_TAG = { core: 'Critical text', layer: 'Critical text, later layer', vulgate: 'Popular versions only', purana: 'Purana or later work', folk: 'Folk or other tradition', history: 'History' };
export const TIER_NOTE = { layer: ', later layer', vulgate: ', popular versions only', purana: ', Purana', folk: ', folk or other' };
export const KIND_TAG = { story: 'Storyline', event: 'Event', avatar: 'Avatar', sage: 'Sage', deva: 'God' };
export const TIER_OPTIONS = ['Critical text only', 'Add later layers', 'Add popular versions', 'Add Puranas', 'Everything'];
const YORD = { origins: -1, satya: 0, treta: 1, dvapara: 2, kali: 3 };

const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Years are astronomical, as in xsd:gYear and Wikidata: 0 is 1 BCE, -355 is 356 BCE.
const era = y => y <= 0 ? [1 - y, 'BCE'] : [y, 'CE'];
export function fmtYears([a, b]) {
  const [x, ex] = era(a), [y, ey] = era(b);
  if (a === b) return `${x} ${ex}`;
  return ex === ey ? `${x}–${y} ${ey}` : `${x} ${ex}–${y} ${ey}`;
}
export const PLACE_VERB = { born: 'Born at', died: 'Died at', ruled: 'Ruled from', lived: 'Lived at', visited: 'Went to', occurred: 'Took place at', founded: 'Founded', capital: 'Capital at', composed: 'Composed in' };
export const IDENT_NOTE = { traditional: 'traditional identification', uncertain: 'identification uncertain' };

export function buildModel(data) {
  const NODES = data.nodes;
  const N = Object.fromEntries(NODES.map(n => [n.id, n]));
  const EDGES = data.edges.map((e, i) => ({ ...e, i, later: e.own === 'purana' || e.own === 'folk' }));

  // A link is no more canonical than either of its ends.
  EDGES.forEach(e => {
    const a = N[e.f], b = N[e.t];
    e.tier = (a.tier === 'history' || b.tier === 'history') ? 'history'
      : RANKED[Math.max(TIER_RANK[e.own], TIER_RANK[a.tier] || 0, TIER_RANK[b.tier] || 0)];
    e.xy = !['line', 'gap', 'deva', 'story'].includes(e.type) && a.yuga in YORD && b.yuga in YORD && a.yuga !== b.yuga;
  });

  const DEG = Object.fromEntries(NODES.map(n => [n.id, 0]));
  EDGES.forEach(e => { if (e.type !== 'part') { DEG[e.f]++; DEG[e.t]++; } });
  const BY_DEG = [...NODES].sort((a, b) => DEG[b.id] - DEG[a.id]);
  const CHIRANJIVI = new Set(NODES.filter(n => n.chiranjivi).map(n => n.id));
  const CATASTROPHES = new Set(NODES.filter(n => n.catastrophe).map(n => n.id));

  // Avatars and incarnations: Vishnu's avatars plus every figure a god is born into, wholly or in part.
  const INCARN = { nodes: new Set(NODES.filter(n => n.kind === 'avatar').map(n => n.id)), edges: new Set(), sources: new Set() };
  const re = /incarnat|avatar|born in part|takes the form|appears as|is born as|born on earth as|reborn as|form of/i;
  EDGES.forEach(e => {
    const src = N[e.f];
    const divine = src.kind === 'deva' || src.kind === 'avatar' || src.yuga === 'deva' || ['sanaka', 'kalidemon', 'brihaspati'].includes(e.f);
    if ((e.type === 'deva' && re.test(e.l || '')) || (e.type === 'reborn' && divine)) { INCARN.nodes.add(e.t); INCARN.edges.add(e.i); INCARN.sources.add(e.f); }
  });

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
    ['r_history', 'History', n => n.yuga === 'history']
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

  const filter = { off: new Set(), srcLevel: 4 };
  const nodeShown = n => n.tier === 'history' || TIER_RANK[n.tier] <= filter.srcLevel;
  const visible = e => !filter.off.has(groupOf(e.type)) && (e.tier === 'history' || TIER_RANK[e.tier] <= filter.srcLevel)
    && nodeShown(N[e.f]) && nodeShown(N[e.t]);

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

  // Accent-insensitive: names that start with the query, then word starts, then anywhere, then descriptions.
  const INDEX = NODES.map(n => ({ n, name: norm(n.label), desc: norm(n.desc) }));
  function search(text, limit = 14) {
    const q = norm(text.trim());
    if (!q) return [];
    const scored = [];
    INDEX.forEach(r => {
      if (!nodeShown(r.n)) return;
      const i = r.name.indexOf(q);
      const s = i === 0 ? 0 : i > 0 ? (/[\s(&,]/.test(r.name[i - 1]) ? 1 : 2) : r.desc.includes(q) ? 3 : -1;
      if (s >= 0) scored.push([s, r.n]);
    });
    scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
    return scored.slice(0, limit).map(x => x[1]);
  }

  const PLACES = Object.fromEntries(data.places.map(p => [p.id, p]));
  const placesOf = {};
  data.attestations.forEach(a => { (placesOf[a.who] ||= []).push(a); });

  return {
    layout: data.layout, NODES, N, EDGES, DEG, BY_DEG, CHIRANJIVI, CATASTROPHES, BEINGS, ROLES, MARKS,
    PLACES, placesOf, POLITIES: data.polities, ERAS: data.eras, filter, nodeShown, visible, focusSets, ancestry, relation, search
  };
}

// A critically damped spring (per ms) pulls the view to its goal and keeps velocity, so wheel notches
// blend into one steady motion instead of restarting an ease each time.
const OMEGA = 0.016, COAST_MS = 180;

// Pan, zoom and pointer input for a full-window canvas. The view supplies its geometry and what taps and hovers do:
// insets() {l,t,r,b}, world() [W, H], minK(), maxK, draw() now, redraw() next frame, zoomed() while zoom changes,
// tap(x, y), hover(x, y) with null on leave, grab() when a gesture starts.
export function attachCamera(cv, o) {
  const cam = { x: 0, y: 0, k: 1 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clampK = k => Math.min(o.maxK, Math.max(o.minK(), k));
  function clamp(c = cam) {
    c.k = clampK(c.k);
    // A view whose world wraps (the globe) sets its own limits.
    if (o.clampTo) { o.clampTo(c); return; }
    const s = o.insets(), [W, H] = o.world(), vw = innerWidth, vh = innerHeight;
    const avail = vw - s.l - s.r, wide = W * c.k;
    c.x = wide <= avail ? s.l + (avail - wide) / 2 : Math.min(s.l + 24, Math.max(vw - s.r - 24 - wide, c.x));
    const tall = H * c.k, availY = innerHeight - s.t - s.b;
    c.y = tall <= availY ? s.t + (availY - tall) / 2 : Math.min(s.t + 40, Math.max(vh - s.b - 80 - tall, c.y));
  }
  const center = () => { const s = o.insets(); return [(s.l + innerWidth - s.r) / 2, (s.t + innerHeight - s.b) / 2]; };

  const goal = { x: 0, y: 0, k: 1 }, vel = { x: 0, y: 0, z: 0 };
  let anchor = null, glideRaf = 0, glideT = 0, anim = 0;
  function sync() { goal.x = cam.x; goal.y = cam.y; goal.k = cam.k; anchor = null; vel.x = vel.y = vel.z = 0; }
  function stop() { cancelAnimationFrame(glideRaf); cancelAnimationFrame(anim); glideRaf = anim = 0; sync(); }
  function glide() { if (!glideRaf) { glideT = performance.now(); glideRaf = requestAnimationFrame(step); } }
  function step(now) {
    glideRaf = 0;
    const dt = Math.min(32, Math.max(1, now - glideT));
    glideT = now;
    // Spring state: offset of the world point under the anchor from its goal, and log zoom from the goal zoom.
    const [ax, ay] = anchor || center();
    const gx = (ax - goal.x) / goal.k, gy = (ay - goal.y) / goal.k;
    let ex = (ax - cam.x) / cam.k - gx, ey = (ay - cam.y) / cam.k - gy, ez = Math.log(cam.k / goal.k);
    if (reduced.matches) ex = ey = ez = vel.x = vel.y = vel.z = 0;
    vel.x += (-OMEGA * OMEGA * ex - 2 * OMEGA * vel.x) * dt; ex += vel.x * dt;
    vel.y += (-OMEGA * OMEGA * ey - 2 * OMEGA * vel.y) * dt; ey += vel.y * dt;
    vel.z += (-OMEGA * OMEGA * ez - 2 * OMEGA * vel.z) * dt; ez += vel.z * dt;
    const k = goal.k * Math.exp(ez);
    if (k !== cam.k) o.zoomed();
    cam.k = k;
    cam.x = ax - (gx + ex) * k;
    cam.y = ay - (gy + ey) * k;
    const rest = Math.hypot(ex, ey) * k < 0.3 && Math.abs(ez) < 1e-3 && Math.hypot(vel.x, vel.y) * k * 16 < 0.3 && Math.abs(vel.z) * 16 < 1e-3;
    if (rest) { cam.x = goal.x; cam.y = goal.y; cam.k = goal.k; sync(); }
    else glideRaf = requestAnimationFrame(step);
    o.draw();
  }
  function panBy(dx, dy) {
    if (!glideRaf) sync();
    goal.x += dx; goal.y += dy;
    clamp(goal); glide();
  }
  function zoomAt(sx, sy, f) {
    if (!glideRaf) sync();
    const k = clampK(goal.k * f);
    goal.x = sx - (sx - goal.x) * (k / goal.k); goal.y = sy - (sy - goal.y) * (k / goal.k); goal.k = k;
    anchor = [sx, sy];
    clamp(goal); glide();
  }
  // Pinch follows the fingers directly.
  function zoomNow(sx, sy, f) {
    const k = clampK(cam.k * f);
    cam.x = sx - (sx - cam.x) * (k / cam.k); cam.y = sy - (sy - cam.y) * (k / cam.k); cam.k = k;
    clamp(); sync(); o.zoomed(); o.redraw();
  }
  function flyTo(x, y, k) {
    const from = { ...cam }, t0 = performance.now(), dur = reduced.matches ? 0 : 420;
    stop();
    const frame = now => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1, q = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      cam.x = from.x + (x - from.x) * q; cam.y = from.y + (y - from.y) * q; cam.k = from.k + (k - from.k) * q;
      if (p < 1 && from.k !== k) o.zoomed();
      o.draw();
      if (p < 1) anim = requestAnimationFrame(frame); else { anim = 0; sync(); }
    };
    anim = requestAnimationFrame(frame);
  }
  function set(x, y, k) { stop(); cam.x = x; cam.y = y; cam.k = k; sync(); o.redraw(); }

  const ptrs = new Map();
  let gesture = null;
  cv.addEventListener('pointerdown', ev => {
    cv.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    stop();
    o.grab();
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, moved: true };
    } else gesture = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false, trail: [[ev.timeStamp, ev.clientX, ev.clientY]] };
  });
  cv.addEventListener('pointermove', ev => {
    if (!ptrs.has(ev.pointerId)) { o.hover(ev.clientX, ev.clientY); return; }
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (gesture.pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomNow((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.k * d / gesture.d / cam.k);
      return;
    }
    const dx = ev.clientX - gesture.x, dy = ev.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) > 4) { gesture.moved = true; cv.classList.add('dragging'); }
    if (gesture.moved && !gesture.pinch) {
      cam.x = gesture.cx + dx; cam.y = gesture.cy + dy; clamp(); sync(); o.redraw();
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
  const end = ev => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    cv.classList.remove('dragging');
    if (ev.type === 'pointerup' && gesture && ptrs.size === 0) {
      if (!gesture.moved) o.tap(ev.clientX, ev.clientY);
      else if (!gesture.pinch) coast(gesture.trail, ev.timeStamp);
    }
    if (ptrs.size === 0) gesture = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!ptrs.size) o.hover(null); });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault();
    cancelAnimationFrame(anim); anim = 0;
    const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? innerHeight : 1;
    // Ctrl or Cmd with the wheel (and a trackpad pinch, which arrives as Ctrl+wheel) zooms; plain wheel scrolls, Shift sideways.
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * unit * 0.0025));
    else if (ev.shiftKey && !ev.deltaX) panBy(-ev.deltaY * unit, 0);
    else panBy(-ev.deltaX * unit, -ev.deltaY * unit);
  }, { passive: false });

  return { cam, clamp, sync, stop, panBy, zoomAt, flyTo, set, center, idle: () => !glideRaf && !anim };
}
