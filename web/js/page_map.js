// The map view: a globe (orthographic) from Natural Earth, opening on South Asia. Places light up, and kingdoms
// show their approximate extent, by what is attested at the chosen age or year.
import { attachCamera, fmtYears, PLACE_VERB, IDENT_NOTE, TIER_NOTE } from './common.js';
import { PAL } from './theme.js';

const AGES = ['origins', 'satya', 'treta', 'dvapara', 'kali'];
const AGE_NAME = { origins: 'Origins', satya: 'Satya Yuga', treta: 'Treta Yuga', dvapara: 'Dvapara Yuga', kali: 'Kali Yuga' };
// -3299 is 3300 BCE, so steps of 25 land on round BCE years.
const YEAR_FROM = -3299, YEAR_TO = 1947, YEAR_STEP = 25;
// Slider units: the five ages share the first 300, recorded history the remaining 700.
const AGE_SPAN = 300, YEAR_SPAN = 700;
// Traditional reckoning: Kali began in 3102 BCE; each earlier age ran its stated years before the next.
const KALI_START = 3102, DURATION = { satya: 1728000, treta: 1296000, dvapara: 864000, kali: 432000 };
const AGE_START = { kali: KALI_START, dvapara: KALI_START + DURATION.dvapara, treta: KALI_START + DURATION.dvapara + DURATION.treta,
  satya: KALI_START + DURATION.dvapara + DURATION.treta + DURATION.satya };
// Within an age, an entry stays lit while the slider is within this share of the age from it.
const AGE_WINDOW = 0.18;
// An entry with one year (a battle, a birth) stays lit this many years either side, so it can be seen while playing.
const WINDOW = 30;
// The globe opens on, and Fit returns to, South Asia: centre lon/lat and the half-width to show, in degrees.
const HOME = { lon: 80, lat: 21, span: 19 };
const R0 = 1000;
const RAD = Math.PI / 180;
const LABEL_FONT = '500 12.5px "Hanken Grotesk", system-ui, sans-serif';
const MODERN_FONT = 'italic 400 11.5px "Hanken Grotesk", system-ui, sans-serif';
const REALM_FONT = '400 17px "Tiro Devanagari Sanskrit", Georgia, serif';
const KIND_TAG = { city: 'City', site: 'Site', river: 'River', mountain: 'Mountain', forest: 'Forest', lake: 'Lake', region: 'Region', realm: 'Realm beyond the earth' };
const REALM_HUES = ['l-line', 'l-story', 'l-deva', 'l-reborn', 'l-tell', 'l-reign', 'l-cross'];

// Unit vectors once; each frame only rotates them.
const toXYZ = (lon, lat) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
// Each line keeps a bounding cap (centre and the cosine-side threshold), so lines wholly behind the globe are skipped.
function packLines(lines) {
  return lines.map(line => {
    const a = new Float64Array(line.length * 3);
    let cx = 0, cy = 0, cz = 0;
    line.forEach(([lon, lat], i) => { const v = toXYZ(lon, lat); a.set(v, i * 3); cx += v[0]; cy += v[1]; cz += v[2]; });
    const m = Math.hypot(cx, cy, cz) || 1;
    cx /= m; cy /= m; cz /= m;
    let minDot = 1;
    for (let i = 0; i < a.length; i += 3) minDot = Math.min(minDot, a[i] * cx + a[i + 1] * cy + a[i + 2] * cz);
    // Cap radius a = acos(minDot): the line can show when the rotated centre's z > cos(90° + a) = -sin a, and a cap
    // wider than a hemisphere always can. On screen it stays within the chord 2 sin(a/2) of its projected centre.
    a.cap = [cx, cy, cz, minDot >= 0 ? -Math.sqrt(1 - minDot * minDot) : -2, Math.sqrt(2 * (1 - minDot))];
    return a;
  });
}

export function startMap(model, basemap) {
  const { N, PLACES, POLITIES } = model;
  const detail = Object.fromEntries(['fine', 'coarse'].map(d => [d, {
    land: packLines(basemap[d].land), rivers: packLines(basemap[d].rivers), borders: packLines(basemap[d].borders),
  }]));
  // Below this globe radius in pixels the 1:110m layers look the same as 1:50m and cost a twelfth.
  const COARSE_BELOW = 700;
  const graticule = packLines([
    ...Array.from({ length: 11 }, (_, i) => Array.from({ length: 73 }, (_, j) => [j * 5 - 180, i * 15 - 75])),
    ...Array.from({ length: 12 }, (_, i) => Array.from({ length: 37 }, (_, j) => [i * 30 - 180, j * 5 - 90])),
  ]);
  const places = Object.values(PLACES).filter(p => p.lon !== null).map(p => ({ ...p, v: toXYZ(p.lon, p.lat) }));
  const heavens = Object.values(PLACES).filter(p => p.kind === 'realm');
  const placeAt = Object.fromEntries(places.map(p => [p.id, p]));
  let heavenAt = {};
  const atPlace = {};
  Object.entries(model.placesOf).forEach(([who, list]) => list.forEach(a => { (atPlace[a.where] ||= []).push(a); }));
  const TERR = basemap.territories.polities;
  const realms = POLITIES.map((q, i) => ({ ...q, hue: REALM_HUES[i % REALM_HUES.length], members: q.places.filter(id => placeAt[id]).map(id => placeAt[id]),
    rows: (TERR[q.id] || []).map(r => ({ from: r.from, to: r.to, rings: packLines(r.rings) })),
    hand: q.extent ? { rings: packLines([q.extent]), hand: true } : null }))
    .filter(q => q.members.length || q.rows.length);

  const $ = id => document.getElementById(id);
  const cv = $('map'), ctx = cv.getContext('2d'), panel = $('mapPanel'), header = document.querySelector('.top'), bar = $('timebar');
  const slider = $('timeSlider'), timeLabel = $('timeLabel'), playBtn = $('timePlay'), todayBtn = $('mapToday');
  let vw = 0, vh = 0, dpr = 1, homeK = 1, worldK = 0.3, S = { l: 0, t: 0, r: 0, b: 0 };
  let active = false, picked = null, hover = null, today = false;
  let raf = 0;
  const redraw = () => { if (!raf && active) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const PERF = new URLSearchParams(location.search).has('perf');
  const stats = { draws: [] };

  // Where an entry falls within its age, solved from the graph: a child comes a generation after its parent (three for
  // "many generations"), a successor after the ruler, a story step just after the one before; people at the same
  // event, spouses and kin, and killer and killed are contemporaries. Repeated weighted averaging settles these into
  // one relative timeline per age, which is then stretched to fill the age.
  const RULES = { line: [1, 1], gap: [3, 1], reign: [1, 1], story: [0.3, 1], meet: [0, 1], part: [0, 1], bond: [0, 1], kill: [0, 0.5], tell: [0, 0.3] };
  const frac = {}, t = {}, links = {};
  for (const e of model.EDGES) {
    const a = N[e.f], b = N[e.t], rule = RULES[e.type];
    if (!rule || a.yuga !== b.yuga || !AGES.includes(a.yuga) || e.f === e.t) continue;
    const [gap, w] = rule;
    // Each side's target is the other's time shifted by the gap: the parent sits a generation before the child.
    (links[e.f] ||= []).push([e.t, -gap, w]);
    (links[e.t] ||= []).push([e.f, gap, w]);
  }
  const inAges = Object.values(N).filter(n => AGES.includes(n.yuga));
  inAges.forEach(n => { t[n.id] = 0; });
  for (let pass = 0; pass < 300; pass++) {
    for (const n of inAges) {
      const ls = links[n.id];
      if (!ls) continue;
      let s = 0, w = 0;
      for (const [o, gap, wt] of ls) { s += (t[o] + gap) * wt; w += wt; }
      t[n.id] = s / w;
    }
  }
  for (const age of AGES) {
    const ns = inAges.filter(n => n.yuga === age), vals = ns.map(n => t[n.id]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    ns.forEach(n => { frac[n.id] = hi > lo ? (t[n.id] - lo) / (hi - lo) : 0.5; });
  }
  // Kali's figures belong to its first centuries; only the end of the age and what it is tied to sit at its close.
  const atEnd = new Set(['endkali', ...model.EDGES.filter(e => e.f === 'endkali' || e.t === 'endkali').map(e => e.f === 'endkali' ? e.t : e.f)]);
  inAges.filter(n => n.yuga === 'kali').forEach(n => { frac[n.id] = atEnd.has(n.id) ? 0.98 : frac[n.id] * 0.3; });

  const yearSteps = Math.round((YEAR_TO - YEAR_FROM) / YEAR_STEP), ageUnit = AGE_SPAN / AGES.length;
  slider.max = String(AGE_SPAN + YEAR_SPAN);
  slider.step = 'any';
  // Origins is split evenly among the eras; within an era, years ago run on a log scale from its start to its end.
  const ERAS = model.ERAS;
  const stepTime = v => {
    if (v >= AGE_SPAN) return { year: Math.min(YEAR_TO, YEAR_FROM + Math.round((v - AGE_SPAN) / YEAR_SPAN * yearSteps) * YEAR_STEP) };
    const age = AGES[Math.min(AGES.length - 1, Math.floor(v / ageUnit))], f = (v % ageUnit) / ageUnit;
    if (age !== 'origins') return { age, f };
    const i = Math.min(ERAS.length - 1, Math.floor(f * ERAS.length)), g = f * ERAS.length - i, e = ERAS[i];
    return { age, f, era: e, ago: Math.exp(Math.log(e.from) + g * (Math.log(e.to) - Math.log(e.from))) };
  };
  const fmtAgo = y => y >= 1e9 ? `${(y / 1e9).toFixed(2)} billion` : `${(Math.round(y / 1e5) / 10).toLocaleString('en')} million`;
  let now = stepTime(+slider.value);
  const total = AGE_SPAN + YEAR_SPAN, yearAt = y => AGE_SPAN + (y - YEAR_FROM) / (YEAR_TO - YEAR_FROM) * YEAR_SPAN;
  $('timeTicks').innerHTML = [
    ...AGES.map((a, i) => [(i + 0.5) * ageUnit, a === 'origins' ? 'Origins' : AGE_NAME[a].replace(' Yuga', ''), 'age']),
    ...[[-2999, '3000 BCE', ''], [-999, '1000 BCE', ''], [1, '1 CE', ''], [1000, '1000', ''], [1947, '1947', 'end']].map(([y, t, c]) => [yearAt(y), t, c]),
  ].map(([v, t, c]) => `<span class="${c}" style="left:${v / total * 100}%">${t}</span>`).join('');

  // Who is attested at a place at the chosen time. The attestation's own period or years win over its entry's;
  // gods stand outside the ages, so a god's seat that names no age is lit in every age.
  function activeAt(a) {
    const who = N[a.who];
    if (!who) return false;
    if (now.age) {
      if (a.years || who.yuga === 'history') return false;
      if (a.period) return a.period === now.age;
      if (who.yuga === 'deva') return true;
      if (who.yuga !== now.age) return false;
      if (now.era) return who.era === now.era.key;
      return frac[who.id] !== undefined && Math.abs(frac[who.id] - now.f) <= AGE_WINDOW;
    }
    const ys = a.years || who.years;
    return !!ys && ys[0] - WINDOW <= now.year && now.year <= ys[1] + WINDOW;
  }
  const litWho = p => (atPlace[p.id] || []).filter(activeAt);
  // A place shows the strongest kind among what is lit there: an event over a god's seat over a person.
  const markOf = as => as.some(a => ['event', 'story'].includes(N[a.who].kind)) ? 'event' : as.some(a => N[a.who].kind === 'deva') ? 'god' : 'person';
  function mark(kind, x, y) {
    if (kind === 'event') { ctx.moveTo(x, y - 6.5); ctx.lineTo(x + 6.5, y); ctx.lineTo(x, y + 6.5); ctx.lineTo(x - 6.5, y); ctx.closePath(); return; }
    if (kind === 'god') {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 3.2 : 7.5;
        i ? ctx.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a)) : ctx.moveTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
      }
      ctx.closePath();
      return;
    }
    ctx.moveTo(x + 5, y); ctx.arc(x, y, 5, 0, Math.PI * 2);
  }
  // The name in use at the chosen time, else the place's main name.
  const nameAt = (p, t = now) => {
    const r = (p.names || []).find(n => t.year !== undefined
      ? n.years && n.years[0] <= t.year && t.year <= n.years[1]
      : n.periods.includes(t.age));
    return r ? r.name : p.label;
  };
  // The name a place bore when an attestation happened.
  const nameFor = (p, a) => {
    const who = N[a.who], ys = a.years || who.years;
    return nameAt(p, ys ? { year: ys[0] } : { age: a.period || who.yuga });
  };
  // A place is on the map only when it belongs to the chosen time: in an age, something there belongs to that age;
  // in recorded history, it has already appeared by that year.
  function inTime(p) {
    return (atPlace[p.id] || []).some(a => {
      const who = N[a.who];
      if (!who) return false;
      if (now.age) return !a.years && (a.period ? a.period === now.age : who.yuga === now.age || who.yuga === 'deva');
      const ys = a.years || who.years;
      return !!ys && ys[0] - WINDOW <= now.year;
    });
  }
  const realmActive = q => now.age ? q.periods.includes(now.age) : !!q.years && q.years[0] <= now.year && now.year <= q.years[1];

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    vw = innerWidth; vh = innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    const wide = vw > 760;
    // Rotation is measured from the view centre, which moves when the panel opens; keep the same spot facing us.
    const keep = started ? view() : null;
    S = { l: 0, t: header.offsetHeight, r: wide && !panel.hidden ? 412 : 0, b: bar.offsetHeight + (!wide && !panel.hidden ? panel.offsetHeight : 0) };
    const half = Math.min(vw - S.l - S.r, vh - S.t - S.b) / 2;
    homeK = (half - 24) / (R0 * Math.sin(HOME.span * RAD));
    worldK = (half - 16) / R0;
    if (keep) {
      const [cx, cy] = center();
      camera.stop();
      cam.x = cx - keep.lon * keep.r; cam.y = cy + keep.lat * keep.r;
      camera.sync();
    }
    redraw();
  }
  const center = () => [(S.l + vw - S.r) / 2, (S.t + vh - S.b) / 2];

  // The camera's pan is the globe's rotation: pixels from the view centre over the radius give radians.
  const camera = attachCamera(cv, {
    insets: () => S, world: () => [0, 0], minK: () => worldK * 0.9,
    get maxK() { return homeK * 12; },
    clampTo: c => {
      const [, cy] = center(), r = R0 * c.k, lim = 80 * RAD * r;
      c.y = Math.min(cy + lim, Math.max(cy - lim, c.y));
    },
    draw: () => active && draw(), redraw, zoomed: () => {},
    tap: (x, y) => { const p = hit(x, y); if (p) pick(p.id); else if (picked) pick(null); },
    hover: (x, y) => {
      const p = x === null ? null : hit(x, y), id = p ? p.id : null;
      cv.classList.toggle('pointing', !!p);
      if (id !== hover) { hover = id; redraw(); }
    },
    grab: () => {},
  });
  const { cam } = camera;
  const view = () => {
    const [cx, cy] = center(), r = R0 * cam.k;
    return { cx, cy, r, lon: -(cam.x - cx) / r, lat: (cam.y - cy) / r };
  };
  const look = (lon, lat, k) => { const [cx, cy] = center(), r = R0 * k; return [cx - lon * RAD * r, cy + lat * RAD * r, k]; };

  // Rotation that brings (lon, lat) to the front of the globe, as a function of a unit vector.
  function rotator(lon, lat) {
    const cl = Math.cos(lon), sl = Math.sin(lon), cp = Math.cos(lat), sp = Math.sin(lat);
    return (x, y, z) => {
      const x1 = x * cl - z * sl, z1 = x * sl + z * cl;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
  }

  function hit(sx, sy) {
    const { cx, cy, r, lon, lat } = view(), rot = rotator(lon, lat);
    let best = null, bd = 14;
    for (const p of places) {
      const [x, y, z] = rot(...p.v);
      // Only places drawn at the chosen time can be hovered or clicked.
      if (z <= 0.05 || (!litWho(p).length && !inTime(p))) continue;
      const d = Math.hypot(cx + x * r - sx, cy - y * r - sy);
      if (d < bd) { bd = d; best = p; }
    }
    for (const p of heavens) {
      const at = heavenAt[p.id];
      if (!at) continue;
      const d = Math.hypot(at[0] - sx, at[1] - sy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // A land ring cut at the horizon: its visible pieces are rejoined along the rim, walking counter-clockwise from
  // each exit to the next entry. Rings are counter-clockwise (land on the left), so that walk keeps land inside;
  // this is the rejoin step of d3-geo's clipCircle.
  function clipRing(ring, rot, cx, cy, r) {
    const n = ring.length / 3, P = new Float64Array(ring.length);
    let anyIn = false, anyOut = false;
    for (let i = 0; i < n; i++) {
      const v = rot(ring[3 * i], ring[3 * i + 1], ring[3 * i + 2]);
      P[3 * i] = v[0]; P[3 * i + 1] = v[1]; P[3 * i + 2] = v[2];
      if (v[2] > 0) anyIn = true; else anyOut = true;
    }
    if (!anyIn) return;
    let px = Infinity, py = Infinity;
    const to = (x, y, start) => {
      const sx = cx + x * r, sy = cy - y * r;
      // Points closer than a pixel to the last drawn one add nothing visible.
      if (!start && Math.abs(sx - px) + Math.abs(sy - py) < 1) return;
      start ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      px = sx; py = sy;
    };
    if (!anyOut) {
      for (let i = 0; i < n; i++) to(P[3 * i], P[3 * i + 1], i === 0);
      ctx.closePath();
      return;
    }
    let s = 0;
    while (P[3 * s + 2] > 0) s++;
    const frags = [];
    let cur = null;
    for (let k = 1; k <= n; k++) {
      const a = (s + k - 1) % n, b = (s + k) % n, za = P[3 * a + 2], zb = P[3 * b + 2];
      if ((za > 0) !== (zb > 0)) {
        const t = za / (za - zb);
        let x = P[3 * a] + t * (P[3 * b] - P[3 * a]), y = P[3 * a + 1] + t * (P[3 * b + 1] - P[3 * a + 1]);
        const m = Math.hypot(x, y) || 1;
        x /= m; y /= m;
        if (zb > 0) cur = { inAng: Math.atan2(y, x), pts: [[x, y]] };
        else if (cur) { cur.pts.push([x, y]); cur.outAng = Math.atan2(y, x); frags.push(cur); cur = null; }
      }
      if (zb > 0 && cur) cur.pts.push([P[3 * b], P[3 * b + 1]]);
    }
    const TAU = Math.PI * 2, used = new Set();
    for (let f0 = 0; f0 < frags.length; f0++) {
      if (used.has(f0)) continue;
      let f = f0, start = true;
      for (let guard = 0; guard <= frags.length; guard++) {
        used.add(f);
        const fr = frags[f];
        fr.pts.forEach(([x, y], i) => to(x, y, start && i === 0));
        start = false;
        let next = f0, gap = Infinity;
        frags.forEach((g, j) => {
          if (used.has(j) && j !== f0) return;
          const d = ((g.inAng - fr.outAng) % TAU + TAU) % TAU;
          if (d < gap) { gap = d; next = j; }
        });
        // Screen angles are negated because screen y points down; the arc still turns counter-clockwise.
        ctx.arc(cx, cy, r, -fr.outAng, -(fr.outAng + gap), true);
        px = py = Infinity;
        if (next === f0) break;
        f = next;
      }
      ctx.closePath();
    }
  }

  function draw() {
    const t0 = PERF ? performance.now() : 0;
    const { cx, cy, r, lon, lat } = view(), rot = rotator(lon, lat);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAL.night; ctx.fillRect(0, 0, vw, vh);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = PAL.band; ctx.fill();
    ctx.strokeStyle = PAL.rule; ctx.lineWidth = 1; ctx.stroke();

    // Polygons: points behind the horizon are pulled onto the rim, so a ring crossing it closes along the edge.
    const { land, rivers, borders } = detail[r < COARSE_BELOW ? 'coarse' : 'fine'];
    const behind = line => {
      const [x, y, z] = rot(line.cap[0], line.cap[1], line.cap[2]);
      if (z <= line.cap[3]) return true;
      const sx = cx + x * r, sy = cy - y * r, rad = line.cap[4] * r + 2;
      return sx + rad < 0 || sx - rad > vw || sy + rad < 0 || sy - rad > vh;
    };
    ctx.beginPath();
    for (const ring of land) if (!behind(ring)) clipRing(ring, rot, cx, cy, r);
    ctx.fillStyle = PAL.land; ctx.fill();

    // Lines: drawn only on the visible side, broken where they pass behind.
    const lines = (set, style) => {
      ctx.beginPath();
      for (const line of set) {
        if (behind(line)) continue;
        let pen = false, px = 0, py = 0;
        for (let i = 0; i < line.length; i += 3) {
          const [x, y, z] = rot(line[i], line[i + 1], line[i + 2]);
          if (z <= 0) { pen = false; continue; }
          const sx = cx + x * r, sy = cy - y * r;
          if (pen && Math.abs(sx - px) + Math.abs(sy - py) < 1 && i + 3 < line.length) continue;
          pen ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
          pen = true; px = sx; py = sy;
        }
      }
      style(); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    lines(graticule, () => { ctx.strokeStyle = PAL.rule; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6; });
    lines(rivers, () => { ctx.strokeStyle = PAL['l-tell']; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.1; });
    if (today) lines(borders, () => { ctx.strokeStyle = PAL.dim; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); });

    const screen = {};
    for (const p of places) {
      const [x, y, z] = rot(...p.v);
      if (z > 0.05) screen[p.id] = [cx + x * r, cy - y * r];
    }
    // Realms beyond the earth sit in an arc just outside the globe's top edge, or along the top of the view once that edge is off-screen.
    heavenAt = {};
    const up = heavens.filter(p => litWho(p).length || inTime(p)), arcR = r + 30;
    up.forEach((p, i) => {
      const k = i - (up.length - 1) / 2;
      if (cy - arcR > S.t + 40) {
        const a = -Math.PI / 2 + k * 120 / arcR;
        heavenAt[p.id] = [cx + arcR * Math.cos(a), cy + arcR * Math.sin(a)];
      } else heavenAt[p.id] = [(S.l + vw - S.r) / 2 + k * 120, S.t + 24];
    });
    Object.assign(screen, heavenAt);
    const lit = [], dark = [];
    for (const p of [...places, ...heavens]) {
      if (!screen[p.id]) continue;
      if (litWho(p).length) lit.push(p); else if (inTime(p)) dark.push(p);
    }

    // Cliopatria's territory for the chosen year, else the extent digitised from the sources (dashed); else only a name.
    const shown = realms.filter(realmActive), anchor = {};
    for (const q of shown) {
      const sourced = now.year !== undefined && q.rows.find(w => w.from <= now.year && now.year <= w.to);
      // Within the sourced span, a year with no territory is a gap in the kingdom, not a reason to guess one.
      if (!sourced && q.rows.length && q.rows[0].from <= now.year && now.year <= q.rows[q.rows.length - 1].to) continue;
      const row = sourced || q.hand;
      if (row) {
        ctx.beginPath();
        let sx = 0, sy = 0, n = 0, top = Infinity, bottom = -Infinity;
        for (const ring of row.rings) {
          if (behind(ring)) continue;
          clipRing(ring, rot, cx, cy, r);
          for (let i = 0; i < ring.length; i += 3) {
            const [x, y, z] = rot(ring[i], ring[i + 1], ring[i + 2]);
            if (z > 0) { sx += x; sy += y; n++; top = Math.min(top, cy - y * r); bottom = Math.max(bottom, cy - y * r); }
          }
        }
        ctx.globalAlpha = 0.14; ctx.fillStyle = PAL[q.hue]; ctx.fill();
        ctx.globalAlpha = 0.5; ctx.strokeStyle = PAL[q.hue]; ctx.lineWidth = 1;
        if (row.hand) ctx.setLineDash([5, 4]);
        ctx.stroke(); ctx.setLineDash([]);
        if (n) anchor[q.id] = [cx + sx / n * r, cy - sy / n * r, top - 14, bottom + 14];
      } else {
        const pts = q.members.map(m => screen[m.id]).filter(Boolean);
        if (pts.length) anchor[q.id] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, Math.min(...pts.map(p => p[1])) - 34];
      }
    }
    ctx.globalAlpha = 1;

    const taken = lit.map(p => { const [x, y] = screen[p.id]; return [x - 6, y - 6, 12, 12]; });
    const free = (x, y, w, h) => !taken.some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
    // Kingdom names in spaced capitals, as atlases letter regions; one that would overlap another is left out at this zoom.
    ctx.font = REALM_FONT; ctx.textBaseline = 'top'; ctx.letterSpacing = '3px';
    for (const q of [...shown].sort((a, b) => b.rows.length - a.rows.length || b.members.length - a.members.length)) {
      if (!anchor[q.id]) continue;
      const t = q.label.toUpperCase(), [tx, ty, above, below] = anchor[q.id], w = ctx.measureText(t).width, lx = tx - w / 2;
      // Over the middle of the territory, else just above or below it.
      const ly = [ty - 10, above !== undefined && above - 10, below !== undefined && below - 10]
        .find(y => y !== false && free(lx - 4, y, w + 8, 20));
      if (ly === undefined) continue;
      taken.push([lx - 4, ly, w + 8, 20]);
      ctx.lineWidth = 3.5; ctx.strokeStyle = PAL.night; ctx.globalAlpha = 0.7; ctx.strokeText(t, lx, ly);
      ctx.globalAlpha = 1; ctx.fillStyle = PAL[q.hue]; ctx.fillText(t, lx, ly);
    }
    ctx.letterSpacing = '0px';
    if (shown.length) {
      ctx.font = MODERN_FONT; ctx.fillStyle = PAL.dim;
      ctx.fillText(vw > 760 ? 'Solid: Cliopatria (Seshat, CC BY 4.0). Dashed: approximate, drawn from the rivers and hills the sources name.'
        : 'Solid: Cliopatria. Dashed: approximate.', 20, vh - S.b - 22);
    }

    // A ring marks what is not on the earth.
    ctx.strokeStyle = PAL.dim; ctx.lineWidth = 1;
    ctx.beginPath();
    up.forEach(p => { const [x, y] = heavenAt[p.id]; ctx.moveTo(x + 14, y); ctx.arc(x, y, 14, 0, Math.PI * 2); });
    ctx.stroke();
    ctx.fillStyle = PAL.dim; ctx.globalAlpha = 0.6;
    ctx.beginPath();
    dark.forEach(p => { const [x, y] = screen[p.id]; ctx.moveTo(x + 2.5, y); ctx.arc(x, y, 2.5, 0, Math.PI * 2); });
    ctx.fill();
    ctx.globalAlpha = 1;
    // A translucent halo instead of shadowBlur, which is costly on canvas.
    ctx.fillStyle = PAL.gold;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    lit.forEach(p => { const [x, y] = screen[p.id]; ctx.moveTo(x + 11, y); ctx.arc(x, y, 11, 0, Math.PI * 2); });
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    lit.forEach(p => mark(markOf(litWho(p)), ...screen[p.id]));
    ctx.fill();
    for (const id of [picked, hover]) {
      if (!id || !screen[id]) continue;
      const [x, y] = screen[id];
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1.6; ctx.stroke();
    }

    // Lit places get their name and who is there; the rest are named only when there is room.
    // Modern names appear only with the overlay, in italics beneath.
    ctx.lineJoin = 'round';
    const label = (p, lines) => {
      const all = today && p.modern && p.modern !== nameAt(p) ? [...lines, { t: `today ${p.modern}`, font: MODERN_FONT, color: PAL.dim }] : lines;
      const [x, y] = screen[p.id], h = 15 * all.length;
      const w = Math.max(...all.map(l => { ctx.font = l.font; return ctx.measureText(l.t).width; }));
      // Candidate positions in the usual cartographic order (Imhof 1975): below, right, left, above.
      const spot = [[x - w / 2, y + 8, 0.5], [x + 12, y - h / 2, 0], [x - 12 - w, y - h / 2, 1], [x - w / 2, y - 8 - h, 0.5]]
        .find(([lx, ly]) => free(lx - 2, ly, w + 4, h));
      if (!spot) return;
      const [lx, ly, align] = spot;
      taken.push([lx - 2, ly, w + 4, h]);
      all.forEach((l, i) => {
        ctx.font = l.font;
        const tx = lx + (w - ctx.measureText(l.t).width) * align;
        ctx.lineWidth = 3.5; ctx.strokeStyle = PAL.night; ctx.strokeText(l.t, tx, ly + i * 15);
        ctx.fillStyle = l.color; ctx.fillText(l.t, tx, ly + i * 15);
      });
    };
    lit.forEach(p => {
      const names = [...new Set(litWho(p).map(a => N[a.who].label))];
      label(p, [{ t: nameAt(p), font: LABEL_FONT, color: PAL.star },
        { t: names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''), font: LABEL_FONT, color: PAL.dim }]);
    });
    dark.forEach(p => { if (p.kind === 'realm' || cam.k >= homeK * 1.6) label(p, [{ t: nameAt(p), font: LABEL_FONT, color: PAL.dim }]); });
    if (PERF) stats.draws.push(performance.now() - t0);
  }

  function setTime(v) {
    slider.value = String(v);
    now = stepTime(+v);
    let main, sub;
    if (now.year !== undefined) { main = fmtYears([now.year, now.year]); sub = 'history'; }
    else if (now.era) { main = AGE_NAME.origins; sub = `${now.era.label}, about ${fmtAgo(now.ago)} years ago by tradition`; }
    else if (now.age === 'kali') {
      // Kali runs forward from 3102 BCE for 432,000 years; its figures crowd its first centuries and Kalki ends it,
      // so years after its start grow on a log scale.
      const after = DURATION.kali ** now.f - 1, y = Math.round(1 - KALI_START + after), step = after < 2000 ? 10 : 1000;
      const r = Math.round(y / step) * step, when = r <= 0 ? `${(1 - r).toLocaleString('en')} BCE` : `${r.toLocaleString('en')} CE`;
      main = AGE_NAME.kali;
      sub = `about ${when} by tradition, ${Math.round(now.f * 100)}% through`;
    } else {
      const bce = Math.round((AGE_START[now.age] - now.f * DURATION[now.age]) / 1000) * 1000;
      main = AGE_NAME[now.age];
      sub = `about ${bce.toLocaleString('en')} BCE by tradition, ${Math.round(now.f * 100)}% through`;
    }
    timeLabel.innerHTML = `<span class="main">${main}</span><span class="sub">${sub}</span>`;
    slider.setAttribute('aria-valuetext', `${main}, ${sub}`);
    if (picked) pick(picked);
    redraw();
  }
  slider.addEventListener('input', () => setTime(+slider.value));
  let playing = 0;
  function play(on) {
    clearTimeout(playing); playing = 0;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? 'Pause' : 'Play';
    if (!on) return;
    const tick = () => {
      const v = +slider.value;
      // About eight seconds per age, then one 25-year step per tick through recorded history.
      const next = v >= +slider.max ? 0 : v < AGE_SPAN ? v + ageUnit / 60 : v + YEAR_SPAN / yearSteps;
      setTime(Math.min(next, +slider.max));
      playing = setTimeout(tick, next < AGE_SPAN ? 130 : 160);
    };
    tick();
  }
  playBtn.onclick = () => play(!playing);
  todayBtn.onclick = () => {
    today = !today;
    todayBtn.setAttribute('aria-pressed', String(today));
    if (picked) pick(picked);
    redraw();
  };

  function pick(id) {
    picked = id;
    if (!id) { panel.hidden = true; resize(); return; }
    const p = PLACES[id], all = (atPlace[id] || []).slice();
    all.sort((a, b) => (activeAt(b) - activeAt(a)) || N[a.who].label.localeCompare(N[b.who].label));
    const realmsHere = POLITIES.filter(q => q.places.includes(id));
    const spanOf = n => n.years ? fmtYears(n.years) : n.periods.map(x => AGE_NAME[x]).join(', ');
    const names = (p.names || []).map(n => `${n.name} (${spanOf(n)})`);
    panel.innerHTML = `
      <div class="panel-head"><h2>${nameAt(p)}</h2><button type="button" class="btn close" data-close>Close</button></div>
      <div class="tags"><span class="tag">${KIND_TAG[p.kind]}</span><span class="tag">${IDENT_NOTE[p.identification] || 'established identification'}</span>${today && p.modern ? `<span class="tag">Today ${p.modern}</span>` : ''}</div>
      ${names.length ? `<h3>Names</h3><p class="realms">${[p.label, ...names].join(', ')}</p>` : ''}
      ${realmsHere.length ? `<h3>Part of</h3><p class="realms">${realmsHere.map(q => `${q.label} (${q.years ? fmtYears(q.years) : q.periods.map(x => AGE_NAME[x]).join(', ')})`).join(', ')}</p>` : ''}
      ${all.length ? `<h3>Attested here</h3><div class="links">${all.map(a => {
        const who = N[a.who], ys = a.years || who.years, epic = who.yuga !== 'history' && !a.years;
        // An epic event at a historically established site is still placed there by tradition, not by evidence.
        const notes = [ys ? fmtYears(ys) : '', TIER_NOTE[a.tier] ? TIER_NOTE[a.tier].slice(2) : '',
          epic && p.identification === 'established' ? 'location by tradition' : ''].filter(Boolean);
        return `<button type="button" data-graph="${who.id}"${activeAt(a) ? '' : ' class="dim"'}><span class="ln" style="background:${activeAt(a) ? PAL.gold : PAL.rule}"></span><span>${who.label}<span class="how">${PLACE_VERB[a.does]} ${nameFor(p, a)}${notes.length ? `, ${notes.join(', ')}` : ''}</span></span></button>`;
      }).join('')}</div>` : '<p>Nothing is attested here yet.</p>'}`;
    const wasHidden = panel.hidden;
    panel.hidden = false;
    if (wasHidden) resize();
    redraw();
  }
  panel.addEventListener('click', ev => {
    if (ev.target.closest('[data-close]')) pick(null);
  });

  addEventListener('resize', () => { if (active) { resize(); camera.clamp(); camera.sync(); } });
  const fit = (animate = true) => {
    const [x, y, k] = look(HOME.lon, HOME.lat, homeK);
    if (animate) camera.flyTo(x, y, k); else camera.set(x, y, k);
  };
  let started = false;
  if (PERF) window.__aoaMap = {
    cam, stats, idle: () => camera.idle(), setTime, pick, view, frac,
    label: () => timeLabel.innerText.replace(/\n/g, ' / '),
    lit: () => [...places, ...heavens].filter(p => litWho(p).length).map(p => `${nameAt(p)}: ${[...new Set(litWho(p).map(a => N[a.who].label))].join(', ')}`),
    dim: () => [...places, ...heavens].filter(p => !litWho(p).length && inTime(p)).map(p => nameAt(p)),
    hit: (x, y) => { const p = hit(x, y); return p ? p.id : null; },
    screenOf: id => {
      if (PLACES[id].kind === 'realm') return heavenAt[id] || null;
      const { cx, cy, r, lon, lat } = view(), p = places.find(q => q.id === id), [x, y, z] = rotator(lon, lat)(...p.v);
      return z > 0 ? [cx + x * r, cy - y * r] : null;
    },
    panelText: () => panel.innerText,
    realms: () => realms.filter(realmActive).map(q => q.label),
  };
  return {
    show(on) {
      active = on;
      cv.hidden = !on; bar.hidden = !on;
      if (!on) { panel.hidden = true; play(false); return; }
      if (picked) panel.hidden = false;
      resize();
      if (!started) { started = true; setTime(0); fit(false); }
      redraw();
    },
    zoom(f) { camera.zoomAt(...center(), f); },
    fit,
    themeChanged() { redraw(); },
    state: () => ({ x: cam.x, y: cam.y, k: cam.k, time: +slider.value, picked, today }),
    restore(s) {
      if (s.today !== today) todayBtn.onclick();
      setTime(s.time);
      camera.set(s.x, s.y, s.k);
      if (s.picked && PLACES[s.picked]) pick(s.picked);
    },
  };
}
