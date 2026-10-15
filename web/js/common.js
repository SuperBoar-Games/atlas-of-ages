// The graph model shared by every view: entries, links, tiers, filters, highlight sets and search.

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
export const TIER_TAG = { core: 'Critical text', layer: 'Critical text, later layer', vulgate: 'Popular versions only', purana: 'Purana or later work', folk: 'Folk or other tradition', history: 'Recorded history' };
export const TIER_NOTE = { layer: ', later layer', vulgate: ', popular versions only', purana: ', Purana', folk: ', folk or other' };
export const KIND_TAG = { story: 'Storyline', event: 'Event', avatar: 'Avatar', sage: 'Sage', deva: 'God' };
export const TIER_OPTIONS = ['Critical text only', 'Add later layers', 'Add popular versions', 'Add Puranas', 'Everything'];
const YORD = { origins: -1, satya: 0, treta: 1, dvapara: 2, kali: 3 };

const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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

  return {
    layout: data.layout, NODES, N, EDGES, DEG, BY_DEG, CHIRANJIVI, CATASTROPHES, BEINGS, ROLES, MARKS,
    filter, nodeShown, visible, focusSets, ancestry, relation, search
  };
}
