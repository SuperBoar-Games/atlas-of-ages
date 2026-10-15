const { W, H, RAIL_X, RX, BANDS, HISTORY, CAPTIONS, ERAS } = DATA.layout;
const NODES = DATA.nodes;
// Curve side comes from the link's identity, so adding a link never flips the others.
const sideOf = k => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) | 0; return h & 1 ? 1 : -1; };
const EDGES = DATA.edges.map((e, i) => ({ ...e, i, later: e.own === 'purana' || e.own === 'folk', side: sideOf(`${e.f}>${e.t}>${e.type}`) }));
const TIER_RANK = { core: 0, layer: 1, vulgate: 2, purana: 3, folk: 4 };
const CHIRANJIVI = new Set(NODES.filter(n => n.chiranjivi).map(n => n.id));
const CATASTROPHES = new Set(NODES.filter(n => n.catastrophe).map(n => n.id));
const SOURCES = Object.fromEntries(NODES.filter(n => n.sources.length).map(n => [n.id, n.sources]));
const N = Object.fromEntries(NODES.map(n => [n.id, n]));

const TYPES = {
  line: { label: 'Lineage', fwd: 'Parent of', rev: 'Child of', css: 'var(--line)' },
  gap: { label: 'Many generations', fwd: 'Ancestor of', rev: 'Descendant of', css: 'var(--line)', group: 'line' },
  bond: { label: 'Marriage & kin', fwd: 'Related to', rev: 'Related to', css: 'var(--line)', group: 'line' },
  reborn: { label: 'Rebirth', fwd: 'Reborn as', rev: 'Previous life', css: 'var(--accent)' },
  cross: { label: 'Crossover', fwd: 'Linked with', rev: 'Linked with', css: 'var(--cross)' },
  kill: { label: 'Slayings', fwd: 'Kills', rev: 'Killed by', css: 'var(--kill)' },
  deva: { label: 'Divine origin', fwd: 'Divine father of', rev: 'Son of', css: 'var(--deva)' },
  tell: { label: 'Narration', fwd: 'Tells', rev: 'Hears', css: 'var(--tell)' },
  reign: { label: 'Rule & succession', fwd: 'Succeeded by', rev: 'Succeeds', css: 'var(--reign)' },
  story: { label: 'Storyline', fwd: 'Leads to', rev: 'Follows', css: 'var(--story)' },
  meet: { label: 'Storylines meet', fwd: 'Meets', rev: 'Meets', css: 'var(--fg)', group: 'story' },
  part: { label: 'Takes part', fwd: 'Involves', rev: 'Takes part in', css: 'var(--story)', group: 'story' }
};
const FILTERS = ['line', 'reborn', 'cross', 'kill', 'reign', 'deva', 'tell', 'story'];
const LEGEND_DASH = { line: '', reborn: '1 4', cross: '7 4', kill: '', reign: '', deva: '', tell: '10 3 2 3', story: '' };
const off = new Set();
let srcLevel = 4, xmode = false;
const groupOf = t => TYPES[t].group || t;
const YORD = { origins: -1, satya: 0, treta: 1, dvapara: 2, kali: 3 };
const YNAME = { origins: 'Origins', satya: 'Satya', treta: 'Treta', dvapara: 'Dvapara', kali: 'Kali' };
const RANKED = ['core', 'layer', 'vulgate', 'purana', 'folk'];
// A link is no more canonical than either of its ends.
EDGES.forEach(e => {
  const a = N[e.f], b = N[e.t];
  e.tier = (a.tier === 'history' || b.tier === 'history') ? 'history'
    : RANKED[Math.max(TIER_RANK[e.own], TIER_RANK[a.tier] || 0, TIER_RANK[b.tier] || 0)];
  e.xy = !['line', 'gap', 'deva', 'story'].includes(e.type) && a.yuga in YORD && b.yuga in YORD && a.yuga !== b.yuga;
});
const nodeShown = n => n.tier === 'history' || TIER_RANK[n.tier] <= srcLevel;
const visible = e => !off.has(groupOf(e.type)) && (e.tier === 'history' || TIER_RANK[e.tier] <= srcLevel) && nodeShown(N[e.f]) && nodeShown(N[e.t]);
const TIER_TAG = { core: 'Critical text', layer: 'Critical text · later layer', vulgate: 'Popular versions only', purana: 'Purana / later work', folk: 'Folk / other tradition', history: 'Recorded history' };
const TIER_NOTE = { layer: ' · later layer', vulgate: ' · popular versions only', purana: ' · Purana', folk: ' · folk / other' };
const tierNote = e => TIER_NOTE[e.tier] || '';
const ARROW = '<svg class="ar" width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5h9M6.5 1.5 10 5 6.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const storyline = id => id.startsWith('k_') ? 'krishna' : id.startsWith('h_') ? 'history' : 'main';

const svg = document.getElementById('g');
const wrap = document.getElementById('wrap');
const panel = document.getElementById('panel');
let NEL = {}, EEL = [], GEL = [];

function blocked(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  return NODES.some(n => {
    if (n === a || n === b) return false;
    const t = ((n.x - a.x) * dx + (n.y - a.y) * dy) / L;
    if (t <= 0.02 || t >= 0.98) return false;
    return Math.hypot(a.x + t * dx - n.x, a.y + t * dy - n.y) < 12;
  });
}

function edgePath(e) {
  const a = N[e.f], b = N[e.t];
  if (['line', 'gap', 'bond', 'story', 'reign'].includes(e.type)) {
    if (e.type === 'story' || !blocked(a, b)) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const bend = Math.max(34, Math.min(110, len * 0.12)) * e.side;
    const cx = (a.x + b.x) / 2 - dy / len * bend, cy = (a.y + b.y) / 2 + dx / len * bend;
    return `M${a.x} ${a.y}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x} ${b.y}`;
  }
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(140, len * 0.15) * e.side * (e.type === 'part' ? 0.5 : 1);
  const cx = (a.x + b.x) / 2 - dy / len * bend, cy = (a.y + b.y) / 2 + dx / len * bend;
  return `M${a.x} ${a.y}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x} ${b.y}`;
}

function nodeMark(n) {
  if (n.kind === 'event') return `<rect class="dot" x="${n.x - 7}" y="${n.y - 7}" width="14" height="14" transform="rotate(45 ${n.x} ${n.y})"/>`;
  if (n.kind === 'story') return `<rect class="dot" x="${n.x - 7}" y="${n.y - 7}" width="14" height="14" rx="2"/>`;
  return `<circle class="dot" cx="${n.x}" cy="${n.y}" r="${n.kind === 'deva' ? 7.5 : 7}"/>`;
}

function render() {
  const out = [];
  BANDS.forEach(b => {
    out.push(`<rect x="0" y="${b.y0}" width="${RAIL_X}" height="${b.y1 - b.y0}" fill="var(--band-${b.id})"/>`);
    out.push(`<line x1="0" x2="${RAIL_X}" y1="${b.y0}" y2="${b.y0}" stroke="var(--rule)"/>`);
    out.push(`<text class="band-name" x="20" y="${b.y0 + 38}" fill="var(--metal-${b.id})">${b.name}</text>`);
    out.push(`<text class="band-meta" x="21" y="${b.y0 + 58}">${b.meta}</text>`);
  });
  const epicEnd = BANDS.find(b => b.id === 'kali').y1;
  out.push(`<rect x="${RAIL_X}" y="0" width="${W - RAIL_X}" height="${epicEnd}" fill="var(--band-deva)"/>`);
  out.push(`<line x1="${RAIL_X}" x2="${RAIL_X}" y1="0" y2="${epicEnd}" stroke="var(--rule)"/>`);
  out.push(`<rect x="0" y="${HISTORY.y0}" width="${W}" height="${HISTORY.y1 - HISTORY.y0}" fill="var(--band-history)"/>`);
  out.push(`<line x1="0" x2="${W}" y1="${HISTORY.y0}" y2="${HISTORY.y0}" stroke="var(--fg)" stroke-width="1.5"/>`);
  out.push(`<text class="band-name" x="20" y="${HISTORY.y0 + 38}" fill="var(--fg)">${HISTORY.name}</text>`);
  out.push(`<text class="band-meta" x="21" y="${HISTORY.y0 + 58}">${HISTORY.meta}</text>`);
  out.push(`<text class="band-meta" x="${W - 20}" y="${HISTORY.y0 + 38}" text-anchor="end">FADED LINES CROSSING THE GAP = RETELLINGS, TRANSLATIONS, CLAIMED DESCENT</text>`);
  out.push(`<text class="band-name" x="${RAIL_X + 16}" y="38" fill="var(--deva)">Devas</text>`);
  out.push(`<text class="band-meta" x="${RAIL_X + 17}" y="58">OUTSIDE THE CYCLE</text>`);
  const kali = BANDS.find(b => b.id === 'kali');
  out.push(`<line x1="0" x2="${RAIL_X}" y1="${kali.y0 + 1}" y2="${kali.y0 + 1}" stroke="var(--metal-kali)" stroke-dasharray="4 4"/>`);
  out.push(`<text class="band-meta" x="${RAIL_X - 14}" y="${kali.y0 + 18}" text-anchor="end">KALI BEGINS WITH KRISHNA'S DEATH</text>`);
  ERAS.forEach(([y, t]) => {
    out.push(`<line class="era" x1="0" x2="${RAIL_X}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="band-meta" x="20" y="${y - 8}">${t}</text>`);
  });
  CAPTIONS.forEach(([t, x, y, a]) => out.push(`<text class="caption" x="${x}" y="${y}" text-anchor="${a || 'middle'}">${t}</text>`));

  out.push('<g id="edges">');
  EDGES.forEach(e => {
    const far = e.type === 'line' && Math.abs(N[e.f].y - N[e.t].y) > 1100;
    const bridge = (N[e.f].yuga === 'history') !== (N[e.t].yuga === 'history');
    out.push(`<path class="edge ${e.type}${e.later ? ' later' : ''}${far ? ' far' : ''}${bridge ? ' bridge' : ''}${e.xy ? ' xy' : ''}${e.type === 'story' ? ' sl-' + storyline(e.f) : ''}${CATASTROPHES.has(e.f) || CATASTROPHES.has(e.t) ? ' cate' : ''}" data-e="${e.i}" d="${edgePath(e)}"/>`);
    if (e.type === 'gap') {
      const a = N[e.f], b = N[e.t];
      out.push(`<text class="gapmark" data-ge="${e.i}" x="${(a.x + b.x) / 2 + 8}" y="${(a.y + b.y) / 2 + 3}">...</text>`);
    }
  });
  out.push('</g><g id="nodes">');
  NODES.forEach(n => {
    const label = n.right
      ? `<text x="${n.x + 16}" y="${n.y + 4.5}">${n.label}</text>`
      : `<text x="${n.x}" y="${n.y + 24}" text-anchor="middle">${n.label}</text>`;
    const ring = (n.span ? `<circle class="ring" cx="${n.x}" cy="${n.y}" r="12"/>` : '') + (CATASTROPHES.has(n.id) ? `<circle class="catring" cx="${n.x}" cy="${n.y}" r="15"/>` : '');
    out.push(`<g class="node ${n.kind} t-${n.tier}${CATASTROPHES.has(n.id) ? ' cat' : ''}${n.kind === 'story' ? ' sl-' + storyline(n.id) : ''}${n.span ? ' span' : ''}${CHIRANJIVI.has(n.id) ? ' chiranjivi' : ''}" data-id="${n.id}" tabindex="0" role="button" aria-label="${n.label}">` +
      `<circle class="hit" cx="${n.x}" cy="${n.y + 8}" r="22"/>${ring}${nodeMark(n)}${label}</g>`);
  });
  out.push('</g>');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out.join('');
  svg.querySelectorAll('.node').forEach(g => { NEL[g.dataset.id] = g; });
  svg.querySelectorAll('[data-e]').forEach(p => { EEL[+p.dataset.e] = p; });
  svg.querySelectorAll('[data-ge]').forEach(t => { GEL[+t.dataset.ge] = t; });
}

function renderLegend() {
  document.getElementById('legend').innerHTML = FILTERS.map(t => {
    const s = TYPES[t], d = LEGEND_DASH[t];
    const sw = `<svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="${s.css}" stroke-width="${t === 'story' ? 3.5 : t === 'reborn' ? 2.6 : 2}" stroke-linecap="round"${d ? ` stroke-dasharray="${d}"` : ''}/></svg>`;
    return `<button type="button" class="chip" data-t="${t}" aria-pressed="true">${sw}${s.label}</button>`;
  }).join('');
  const shown = EDGES.filter(e => e.type !== 'part').length;
  document.getElementById('stats').textContent = `${NODES.length} figures and events · ${shown} links`;
}

function applyFilters() {
  NODES.forEach(n => NEL[n.id].classList.toggle('off', !nodeShown(n)));
  svg.querySelectorAll('.xyn').forEach(el => el.classList.remove('xyn'));
  EDGES.forEach(e => {
    const v = visible(e);
    if (v && e.xy) [e.f, e.t].forEach(i => NEL[i].classList.add('xyn'));
    EEL[e.i].classList.toggle('off', !v);
    const gm = GEL[e.i];
    if (gm) gm.classList.toggle('off', !v);
  });
}

let selected = null;

function ancestry(id) {
  const nodes = new Set(), edges = new Set(), stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    EDGES.forEach(e => {
      if (e.t === cur && (e.type === 'line' || e.type === 'gap') && !e.later && !N[e.f].later && !edges.has(e.i)) {
        edges.add(e.i);
        if (!nodes.has(e.f)) { nodes.add(e.f); stack.push(e.f); }
      }
    });
  }
  return { nodes, edges };
}

function relation(e, id) {
  const fwd = e.f === id, t = TYPES[e.type];
  return fwd ? (e.l || t.fwd) : (e.r || t.rev);
}

const ORDER = { line: 0, gap: 0, bond: 1, deva: 2, reborn: 3, reign: 4, story: 5, meet: 5, part: 6, cross: 7, kill: 8, tell: 9 };

function select(id, scroll) {
  if (id && focusKey) clearFocus();
  selected = id;
  (window.__lit || []).forEach(el => el.classList.remove('hi', 'anc', 'cur'));
  const lit = window.__lit = [];
  const mark = (el, ...c) => { if (el) { el.classList.add(...c); lit.push(el); } };
  if (!id) { svg.classList.remove('sel'); panel.hidden = true; return; }
  svg.classList.add('sel');
  const n = N[id];
  const nodeEl = i => NEL[i];
  mark(nodeEl(id), 'cur', 'hi');

  const anc = !off.has('line') ? ancestry(id) : { nodes: new Set(), edges: new Set() };
  if (srcLevel < 4) {
    anc.edges.forEach(i => { if (!visible(EDGES[i])) anc.edges.delete(i); });
    anc.nodes.forEach(i => { if (!nodeShown(N[i])) anc.nodes.delete(i); });
  }
  anc.edges.forEach(i => mark(EEL[i], 'anc'));
  anc.nodes.forEach(i => mark(nodeEl(i), 'anc'));

  const links = EDGES.filter(e => (e.f === id || e.t === id) && visible(e));
  links.forEach(e => {
    mark(EEL[e.i], 'hi');
    mark(nodeEl(e.f === id ? e.t : e.f), 'hi');
  });
  links.sort((a, b) => ORDER[a.type] - ORDER[b.type] || N[a.f === id ? a.t : a.f].y - N[b.f === id ? b.t : b.f].y);

  const yugaName = n.yuga === 'deva' ? 'Deva' : n.yuga === 'history' ? 'Recorded history' : BANDS.find(b => b.id === n.yuga).name;
  const kindTag = { story: 'Storyline', event: 'Event', avatar: 'Avatar', sage: 'Sage', deva: 'Deva' }[n.kind];
  const chain = [...anc.nodes].map(i => N[i]).sort((a, b) => a.y - b.y || a.x - b.x);

  panel.innerHTML = `
    <div class="panel-head"><h2>${n.label}</h2><button type="button" class="close" id="close">Close</button></div>
    <div class="tags"><span class="tag y-${n.yuga}">${yugaName}</span>${kindTag && n.yuga !== 'deva' ? `<span class="tag">${kindTag}</span>` : ''}${n.yuga !== 'deva' ? `<span class="tag t-${n.tier}">${TIER_TAG[n.tier]}</span>` : ''}${CHIRANJIVI.has(n.id) ? '<span class="tag later">Chiranjivi</span>' : n.span ? '<span class="tag">Lives across yugas</span>' : ''}</div>
    <p>${n.desc}</p>
    ${typeof SOURCES !== 'undefined' && SOURCES[n.id] ? `<p class="cite"><span>Sources</span> ${SOURCES[n.id].map(([t, u], j) => `<a href="${u}" target="_blank" rel="noopener"${j >= 8 ? ' class="more" hidden' : ''}>${t}</a>`).join(' ')}${SOURCES[n.id].length > 8 ? `<button type="button" class="morebtn">${SOURCES[n.id].length - 8} more</button>` : ''}</p>` : ''}
    ${chain.length ? `<h3>Traceback · ${chain.length} ancestors</h3><div class="trace">${chain.map(c =>
      `<button type="button" data-go="${c.id}">${c.label}</button>${ARROW}`).join('')}<b>${n.label}</b></div>` : ''}
    ${links.length ? `<h3>Links · ${links.length}</h3><div class="conns">${links.map(e => {
      const other = N[e.f === id ? e.t : e.f];
      return `<button type="button" class="conn" data-go="${other.id}"><span class="sw" style="background:${TYPES[e.type].css}"></span><span><span class="k">${relation(e, id)}${tierNote(e)}${e.xy ? ` · ${YNAME[N[e.f].yuga]} to ${YNAME[N[e.t].yuga]}` : ''}</span><br>${other.label}</span></button>`;
    }).join('')}</div>` : ''}`;
  panel.hidden = false;
  panel.scrollTop = 0;
  document.getElementById('close').onclick = () => select(null);
  panel.querySelectorAll('[data-go]').forEach(b => b.onclick = () => select(b.dataset.go, true));
  const mb = panel.querySelector('.morebtn');
  if (mb) mb.onclick = () => { panel.querySelectorAll('.cite .more').forEach(a => { a.hidden = false; }); mb.remove(); };
  if (scroll) centerOn(n);
}

function showCrossovers() {
  const list = EDGES.filter(e => e.xy && visible(e));
  const groups = {};
  list.forEach(e => {
    const [a, b] = [N[e.f], N[e.t]].sort((p, q) => YORD[p.yuga] - YORD[q.yuga]);
    const k = `${YNAME[a.yuga]} and ${YNAME[b.yuga]}`;
    (groups[k] = groups[k] || []).push({ e, a, b });
  });
  const order = Object.keys(groups).sort((p, q) => {
    const r = s => s.split(' and ').map(y => YORD[y.toLowerCase()]);
    const [p0, p1] = r(p), [q0, q1] = r(q);
    return p0 - q0 || p1 - q1;
  });
  panel.innerHTML = `
    <div class="panel-head"><h2>Crossovers</h2><button type="button" class="close" id="close">Close</button></div>
    <p>${list.length} links reach from one yuga into another. Tap a name to open it.</p>
    <div class="xlist">${order.map(k => `<h3>${k} · ${groups[k].length}</h3><div class="conns">${groups[k].map(({ e, a, b }) => {
      const from = N[e.f], to = N[e.t];
      return `<button type="button" class="conn" data-go="${from.id}"><span class="sw" style="background:${TYPES[e.type].css}"></span><span><span class="k">${relation(e, from.id)}${tierNote(e)}</span><br>${from.label}${ARROW}${to.label}</span></button>`;
    }).join('')}</div>`).join('')}</div>`;
  panel.hidden = false;
  panel.scrollTop = 0;
  document.getElementById('close').onclick = () => setX(false);
  panel.querySelectorAll('[data-go]').forEach(b => b.onclick = () => select(b.dataset.go, true));
}

function setX(on) {
  if (on && cmode) setC(false);
  xmode = on;
  document.getElementById('xmode').setAttribute('aria-pressed', String(on));
  svg.classList.toggle('xmode', on);
  document.getElementById('keyBtn').classList.toggle('on', xmode || cmode);
  if (selected) select(null);
}

let cmode = false;
function showCatastrophes() {
  const list = NODES.filter(n => CATASTROPHES.has(n.id) && nodeShown(n)).sort((a, b) => a.y - b.y);
  const bandOf = n => n.yuga === 'history' ? 'Recorded history' : (BANDS.find(b => b.id === n.yuga) || { name: 'Gods' }).name;
  const groups = [];
  list.forEach(n => { const g = bandOf(n); if (!groups.length || groups[groups.length - 1][0] !== g) groups.push([g, []]); groups[groups.length - 1][1].push(n); });
  panel.innerHTML = `
    <div class="panel-head"><h2>Catastrophes</h2><button type="button" class="close" id="close">Close</button></div>
    <p>${list.length} floods, fires, poisons and wars, in order. Tap one to open it.</p>
    <div class="xlist">${groups.map(([g, ns]) => `<h3>${g} · ${ns.length}</h3><div class="conns">${ns.map(n =>
      `<button type="button" class="conn" data-go="${n.id}"><span class="sw" style="background:var(--kill)"></span><span>${n.label}<br><span class="k">${n.desc.split('. ')[0].replace(/\.$/, '')}.</span></span></button>`).join('')}</div>`).join('')}</div>`;
  panel.hidden = false;
  panel.scrollTop = 0;
  document.getElementById('close').onclick = () => setC(false);
  panel.querySelectorAll('[data-go]').forEach(b => b.onclick = () => select(b.dataset.go, true));
}
function setC(on) {
  if (on && xmode) setX(false);
  cmode = on;
  document.getElementById('cmode').setAttribute('aria-pressed', String(on));
  svg.classList.toggle('cmode', on);
  document.getElementById('keyBtn').classList.toggle('on', xmode || cmode);
  svg.querySelectorAll('.caten').forEach(el => el.classList.remove('caten'));
  if (on) EDGES.forEach(e => { if (visible(e) && (CATASTROPHES.has(e.f) || CATASTROPHES.has(e.t))) [e.f, e.t].forEach(i => NEL[i].classList.add('caten')); });
  if (selected) select(null);
}

let scale = 1;
function setScale(s, keepCenter = true) {
  s = Math.max(0.35, Math.min(1.6, s));
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / scale;
  const cy = (wrap.scrollTop + wrap.clientHeight / 2) / scale;
  scale = s;
  svg.setAttribute('width', Math.round(W * s));
  svg.setAttribute('height', Math.round(H * s));
  if (keepCenter) {
    wrap.scrollLeft = cx * s - wrap.clientWidth / 2;
    wrap.scrollTop = cy * s - wrap.clientHeight / 2;
  }
}
function fitScale() { return Math.max(0.6, Math.min(1, (wrap.clientWidth - 2) / W)); }
const smooth = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
function centerOn(n) {
  const panelH = panel.hidden || window.innerWidth >= 980 ? 0 : panel.offsetHeight * 0.4;
  wrap.scrollTo({ left: n.x * scale - wrap.clientWidth / 2, top: n.y * scale - wrap.clientHeight / 2 + panelH, behavior: smooth() });
}

let drag = null, dragged = false;
wrap.addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
  drag = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
  dragged = false;
});
window.addEventListener('pointermove', ev => {
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) > 4) { dragged = true; wrap.classList.add('dragging'); }
  if (dragged) { wrap.scrollLeft = drag.l - dx; wrap.scrollTop = drag.t - dy; }
});
window.addEventListener('pointerup', () => { drag = null; wrap.classList.remove('dragging'); });

svg.addEventListener('click', ev => {
  if (dragged) { dragged = false; return; }
  const g = ev.target.closest('.node');
  if (g) select(g.dataset.id === selected ? null : g.dataset.id);
  else select(null);
});
svg.addEventListener('keydown', ev => {
  const g = ev.target.closest && ev.target.closest('.node');
  if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(g.dataset.id); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !openDDs.size) select(null); });

document.getElementById('legend').addEventListener('click', ev => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  const t = b.dataset.t, on = off.has(t);
  if (on) off.delete(t); else off.add(t);
  b.setAttribute('aria-pressed', String(on));
  applyFilters();
  if (selected) select(selected);
});
// Custom dropdowns: a button that opens a listbox, with arrow keys, Enter, Escape and outside-click support.
const TICK = '<svg class="tick" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 6 10.5 11 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const openDDs = new Set();
function closeDD(dd, focusBtn) {
  dd.menu.hidden = true; dd.btn.setAttribute('aria-expanded', 'false'); openDDs.delete(dd);
  if (focusBtn) dd.btn.focus();
}
function makeDD(rootId, items, opts) {
  const root = document.getElementById(rootId);
  const dd = { btn: root.querySelector('.dd-btn'), menu: root.querySelector('.dd-menu'), label: root.querySelector('.dd-label'), value: opts.value };
  dd.menu.innerHTML = items.map((it, i) =>
    `<li role="option" id="${rootId}-${i}" tabindex="-1" data-v="${it.value}" aria-selected="${opts.showSelected && it.value === dd.value}">${it.icon || '<span></span>'}<span>${it.label}${it.hint ? `<span class="hint">${it.hint}</span>` : ''}</span>${opts.showSelected ? TICK : '<span></span>'}</li>`).join('');
  const lis = [...dd.menu.querySelectorAll('li')];
  const focusAt = i => { lis.forEach(l => l.classList.remove('active')); const l = lis[(i + lis.length) % lis.length]; l.classList.add('active'); l.focus(); };
  const pick = li => {
    const v = li.dataset.v;
    if (opts.showSelected) {
      dd.value = v;
      lis.forEach(l => l.setAttribute('aria-selected', String(l === li)));
      dd.label.textContent = items.find(it => String(it.value) === v).label;
    }
    closeDD(dd, true);
    opts.onPick(v);
  };
  const open = () => {
    openDDs.forEach(o => closeDD(o));
    dd.menu.hidden = false; dd.btn.setAttribute('aria-expanded', 'true'); openDDs.add(dd);
    dd.menu.style.left = '0px';
    const over = dd.menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
    if (over > 0) dd.menu.style.left = `${-over}px`;
    const sel = lis.findIndex(l => l.getAttribute('aria-selected') === 'true');
    focusAt(sel >= 0 ? sel : 0);
  };
  dd.btn.addEventListener('click', ev => { ev.stopPropagation(); dd.menu.hidden ? open() : closeDD(dd); });
  dd.btn.addEventListener('keydown', ev => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); open(); } });
  dd.menu.addEventListener('click', ev => { ev.stopPropagation(); const li = ev.target.closest('li'); if (li) pick(li); });
  dd.menu.addEventListener('keydown', ev => {
    const i = lis.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusAt(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusAt(i - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); focusAt(0); }
    else if (ev.key === 'End') { ev.preventDefault(); focusAt(lis.length - 1); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (i >= 0) pick(lis[i]); }
    else if (ev.key === 'Escape' || ev.key === 'Tab') { if (ev.key === 'Escape') ev.stopPropagation(); closeDD(dd, ev.key === 'Escape'); }
  });
  return dd;
}
document.addEventListener('click', () => openDDs.forEach(o => closeDD(o)));

const bandSwatch = id => `<span class="dd-sw" style="background:var(--band-${id});border-color:var(--metal-${id})"></span>`;
makeDD('jumpDD', [
  ...BANDS.map(b => ({ value: b.y0, label: b.name, icon: bandSwatch(b.id), hint: b.meta.charAt(0) + b.meta.slice(1).toLowerCase() })),
  { value: HISTORY.y0, label: 'Recorded history', icon: '<span class="dd-sw" style="background:var(--band-history);border-color:var(--fg)"></span>', hint: 'c. 3300 BCE to 1947 CE' }
], { onPick: v => wrap.scrollTo({ top: Number(v) * scale, behavior: smooth() }) });

const tierIcon = (fill, stroke, dash, w) => `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="${fill}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
document.getElementById('keyBtn').onclick = ev => {
  const kp = document.getElementById('keyPanel'), open = kp.hidden;
  kp.hidden = !open;
  ev.currentTarget.setAttribute('aria-expanded', String(open));
};
// Character types for the key. Kinds come from the data; the rest are hand-sorted lists.
// Avatars and incarnations of every god: Vishnu's avatars plus every node a god or divine being is born into, wholly or in part.
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

const BEINGS_KEY = [
  ['god', 'Devas and avatars'], ['asura', 'Asuras'], ['rakshasa', 'Rakshasas'], ['naga', 'Nagas'], ['yaksha', 'Yakshas'],
  ['gandharva', 'Gandharvas'], ['apsara', 'Apsaras'], ['vanara', 'Vanaras'], ['riksha', 'Rikshas (bears)'],
  ['beast', 'Divine birds and beasts'], ['sage', 'Rishis and sages'], ['human', 'Humans']
].map(([k, label]) => [k, label, n => n.being === k]);

// Roles cut across the classes above, so a figure can carry several.
const ROLE_SETS = { king: new Set(), women: new Set() };
NODES.forEach(n => n.roles.forEach(r => ROLE_SETS[r].add(n.id)));
const ROLES_KEY = [
  ['avatar', 'Avatars and incarnations', n => INCARN.nodes.has(n.id)],
  ['king', 'Kings', n => ROLE_SETS.king.has(n.id)],
  ['women', 'Women and goddesses', n => ROLE_SETS.women.has(n.id)],
  ['event', 'Events and storylines', n => (n.kind === 'event' || n.kind === 'story') && n.yuga !== 'history'],
  ['history', 'Recorded history', n => n.yuga === 'history']
];
const TYPES_KEY = [...BEINGS_KEY, ...ROLES_KEY];
const typeButtons = list => list.map(([k, label]) =>
  `<button type="button" class="kitem" data-k="t_${k}" aria-pressed="false"><span>${label}</span><span class="kc"></span></button>`).join('');
document.getElementById('beingKey').innerHTML = typeButtons(BEINGS_KEY);
document.getElementById('roleKey').innerHTML = typeButtons(ROLES_KEY);

// Key marks: tap one to light up every node and link that carries it
let focusKey = null;
const FOCUS = {
  core: n => n.tier === 'core' && n.yuga !== 'deva', layer: n => n.tier === 'layer', vulgate: null, purana: n => n.tier === 'purana',
  folk: n => n.tier === 'folk', chiranjivi: n => CHIRANJIVI.has(n.id), span: n => n.span, cat: n => CATASTROPHES.has(n.id), cross: null,
  ...Object.fromEntries(TYPES_KEY.map(([k, , f]) => [`t_${k}`, f]))
};
const TIER_KEYS = new Set(['core', 'layer', 'vulgate', 'purana', 'folk']);
function focusSets(k) {
  const nodes = new Set(), near = new Set(), edges = new Set();
  if (k === 'cross') {
    EDGES.forEach(e => { if (e.xy && visible(e)) { edges.add(e.i); nodes.add(e.f); nodes.add(e.t); } });
  } else if (k === 't_avatar') {
    INCARN.nodes.forEach(i => nodes.add(i));
    INCARN.edges.forEach(i => { if (visible(EDGES[i])) edges.add(i); });
    INCARN.sources.forEach(i => { if (!nodes.has(i)) near.add(i); });
  } else {
    if (FOCUS[k]) NODES.forEach(n => { if (FOCUS[k](n)) nodes.add(n.id); });
    EDGES.forEach(e => {
      if (!visible(e) && e.type !== 'part') return;
      const hit = TIER_KEYS.has(k) ? e.tier === k : (nodes.has(e.f) || nodes.has(e.t)) && e.type !== 'part';
      if (hit) { edges.add(e.i); [e.f, e.t].forEach(i => { if (!nodes.has(i)) near.add(i); }); }
    });
  }
  return { nodes, near, edges };
}
function clearFocus() {
  focusKey = null;
  svg.querySelectorAll('.fx, .fxn, .fxe').forEach(el => el.classList.remove('fx', 'fxn', 'fxe'));
  svg.classList.remove('fmode');
  document.querySelectorAll('.kitem').forEach(b => b.setAttribute('aria-pressed', 'false'));
  document.getElementById('keyBtn').classList.remove('on');
}
function setFocus(k) {
  const same = focusKey === k;
  clearFocus();
  if (same) return;
  if (selected) select(null);
  focusKey = k;
  const { nodes, near, edges } = focusSets(k);
  nodes.forEach(i => NEL[i] && NEL[i].classList.add('fx'));
  near.forEach(i => NEL[i] && NEL[i].classList.add('fxn'));
  edges.forEach(i => EEL[i].classList.add('fxe'));
  svg.classList.add('fmode');
  document.querySelector(`.kitem[data-k="${k}"]`).setAttribute('aria-pressed', 'true');
  document.getElementById('keyBtn').classList.add('on');
}
// Search: accent-insensitive match on names first, then on descriptions
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const SEARCH = NODES.map(n => ({ n, name: norm(n.label), desc: norm(n.desc) }));
const qIn = document.getElementById('q'), qRes = document.getElementById('qres');
let qHits = [], qAt = -1;
const placeOf = n => n.yuga === 'deva' ? 'God' : n.yuga === 'history' ? 'Recorded history' : (BANDS.find(b => b.id === n.yuga) || {}).name;
function qClose() { qRes.hidden = true; qIn.setAttribute('aria-expanded', 'false'); qAt = -1; }
function qPick(n) { qClose(); qIn.value = ''; qIn.blur(); select(n.id, true); }
function qShow() {
  const q = norm(qIn.value.trim());
  if (!q) { qClose(); return; }
  const scored = [];
  SEARCH.forEach(r => {
    const i = r.name.indexOf(q);
    const s = i === 0 ? 0 : i > 0 ? (/[\s(&,]/.test(r.name[i - 1]) ? 1 : 2) : r.desc.includes(q) ? 3 : -1;
    if (s >= 0) scored.push([s, r.n]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
  qHits = scored.slice(0, 14).map(x => x[1]);
  qRes.innerHTML = qHits.length ? qHits.map((n, i) =>
    `<li role="option" id="qr-${i}" data-i="${i}" aria-selected="false"><span class="dd-sw" style="background:var(--band-${n.yuga === 'deva' ? 'deva' : n.yuga});border-color:var(--rule)"></span><span>${n.label}<span class="hint">${placeOf(n)}${n.kind !== 'person' ? ' · ' + ({ deva: 'god', avatar: 'avatar', sage: 'sage', event: 'event', story: 'storyline', folk: 'folk figure' }[n.kind] || '') : ''}</span></span></li>`).join('')
    : '<li class="empty">No matches</li>';
  qRes.hidden = false; qIn.setAttribute('aria-expanded', 'true'); qAt = -1;
}
function qMove(i) {
  if (!qHits.length) return;
  qAt = (i + qHits.length) % qHits.length;
  qRes.querySelectorAll('li[role="option"]').forEach((li, j) => { li.classList.toggle('active', j === qAt); li.setAttribute('aria-selected', String(j === qAt)); });
  qIn.setAttribute('aria-activedescendant', `qr-${qAt}`);
  qRes.querySelector(`#qr-${qAt}`).scrollIntoView({ block: 'nearest' });
}
qIn.addEventListener('input', qShow);
qIn.addEventListener('focus', () => { if (qIn.value.trim()) qShow(); });
qIn.addEventListener('keydown', ev => {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if (qRes.hidden) qShow(); qMove(qAt + 1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); qMove(qAt - 1); }
  else if (ev.key === 'Enter') { ev.preventDefault(); const n = qHits[qAt >= 0 ? qAt : 0]; if (n) qPick(n); }
  else if (ev.key === 'Escape') { ev.stopPropagation(); qClose(); }
});
qRes.addEventListener('mousedown', ev => ev.preventDefault());
qRes.addEventListener('click', ev => { ev.stopPropagation(); const li = ev.target.closest('li[data-i]'); if (li) qPick(qHits[+li.dataset.i]); });
qIn.addEventListener('blur', () => setTimeout(qClose, 120));

document.querySelectorAll('.kitem').forEach(b => {
  const { nodes, edges } = focusSets(b.dataset.k);
  const n = b.dataset.k === 'vulgate' || b.dataset.k === 'cross' ? edges.size : nodes.size;
  if (!n) { b.hidden = true; return; }
  b.querySelector('.kc').textContent = n;
  b.onclick = () => setFocus(b.dataset.k);
});
document.getElementById('zin').onclick = () => setScale(scale * 1.2);
document.getElementById('zout').onclick = () => setScale(scale / 1.2);
document.getElementById('zfit').onclick = () => setScale(fitScale());

render();
renderLegend();
applyFilters();
setScale(fitScale(), false);
wrap.scrollLeft = Math.max(0, (W * scale - wrap.clientWidth) / 2 - 120);
if (window.innerWidth >= 980) select('arjuna', false);
wrap.scrollTop = 0;
