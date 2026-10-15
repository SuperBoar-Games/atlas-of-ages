"""Type-rule layout: periods as stacked bands, lineage layers inside each band, rows bounded to a fixed width."""
import math
from collections import defaultdict


def _layers(ids, succ):
    """Longest-path layering; DFS back edges are ignored so cycles cannot loop."""
    state, order, dag = {}, [], defaultdict(list)

    def visit(u):
        state[u] = 1
        for v in succ[u]:
            if state.get(v) == 1:
                continue
            dag[u].append(v)
            if v not in state:
                visit(v)
        state[u] = 2
        order.append(u)

    for u in ids:
        if u not in state:
            visit(u)
    layer = {u: 0 for u in ids}
    for u in reversed(order):
        for v in dag[u]:
            layer[v] = max(layer[v], layer[u] + 1)
    return layer, dag


def _compact(row, want, gap, lo, hi):
    """Place row (already ordered) as close to want[] as min spacing and bounds allow."""
    n = len(row)
    if not n:
        return {}
    span = gap * (n - 1)
    xs = [want[u] for u in row]
    xs[0] = max(xs[0], lo)
    for i in range(1, n):
        xs[i] = max(xs[i], xs[i - 1] + gap)
    if xs[-1] > hi:
        xs[-1] = hi
        for i in range(n - 2, -1, -1):
            xs[i] = min(xs[i], xs[i + 1] - gap)
    if xs[0] < lo:
        shift = (lo + hi - span) / 2 - xs[0] if span <= hi - lo else lo - xs[0]
        xs = [x + shift for x in xs]
    return dict(zip(row, xs))


def _mean(vals, default):
    return sum(vals) / len(vals) if vals else default


def _spread(xs, ws, lo, hi):
    """Centres as close to xs (in order) as names of widths ws allow without touching, within [lo, hi]."""
    out = list(xs)
    out[0] = max(out[0], lo + ws[0] / 2)
    for i in range(1, len(out)):
        out[i] = max(out[i], out[i - 1] + (ws[i - 1] + ws[i]) / 2)
    if out[-1] > hi - ws[-1] / 2:
        out[-1] = hi - ws[-1] / 2
        for i in range(len(out) - 2, -1, -1):
            out[i] = min(out[i], out[i + 1] - (ws[i] + ws[i + 1]) / 2)
    return out


def _story_order(steps, edges, years):
    """A band's storyline steps in reading order: by date where every step has one, else along the story links."""
    if steps and all(u in years for u in steps):
        return sorted(steps, key=lambda u: (years[u], u))
    succ = defaultdict(list)
    for e in edges:
        if e['type'] == 'story' and e['f'] in steps and e['t'] in steps and e['f'] != e['t']:
            succ[e['f']].append(e['t'])
    layer, dag = _layers(sorted(steps), succ)
    has_pred = {v for u in dag for v in dag[u]}
    order, seen = [], set()

    # Each chain is read through before the next starts; chains begin in order of their first step's depth.
    def walk(u):
        seen.add(u)
        order.append(u)
        for v in sorted(dag[u], key=lambda v: (layer[v], v)):
            if v not in seen:
                walk(v)

    for u in sorted(steps, key=lambda u: (layer[u], u)):
        if u not in has_pred and u not in seen:
            walk(u)
    for u in sorted(steps):
        if u not in seen:
            walk(u)
    return order


def layout(nodes, edges, rules):
    sp = rules['spacing']
    W, gap, margin = rules['width'], sp['x'], sp['margin']
    lo, hi, mid = margin, W - margin, W / 2
    cap = max(1, int((hi - lo) // gap) + 1)
    layer_types = set(rules['layerLinks'])
    pull = rules['pull']
    kind_rank = {k: i for i, k in enumerate(rules['looseOrder'])}
    period_of = {n['id']: n['yuga'] for n in nodes}
    kind_of = {n['id']: n['kind'] for n in nodes}

    nbrs = defaultdict(list)
    for e in edges:
        w = pull.get(e['type'], pull['*'])
        nbrs[e['f']].append((e['t'], w))
        nbrs[e['t']].append((e['f'], w))

    labels = {n['id']: n['label'] for n in nodes}
    years = {n['id']: n['years'][0] for n in nodes if n.get('years')}
    # A band with closeWith holds an age's close (that entry and what links to it) apart from the rest of the age,
    # as Kali's end comes after History, which lies within Kali.
    closing = {}
    for b in rules['bands']:
        if b.get('closeWith'):
            end = b['closeWith']
            closing[b['period']] = {end} | {v for v, _ in nbrs[end] if period_of.get(v) == b['period']}

    def members(b):
        p, end = b['period'], closing.get(b['period'], set())
        return {n['id'] for n in nodes if n['yuga'] == p and ((n['id'] in end) == bool(b.get('closeWith')))}

    x, band_rows, stories = {}, {}, {}
    for bi, b in enumerate(rules['bands']):
        p = b['period']
        mine = members(b)
        # Storyline steps are read in the Stories panel, not placed on the canvas; the band is laid out by lineage alone.
        steps = {u for u in mine if kind_of[u] == 'story'}
        stories[bi] = _story_order(steps, edges, years)
        ids = sorted(mine - steps)

        succ, pred = defaultdict(list), defaultdict(list)
        for e in edges:
            if (e['type'] in layer_types and e['f'] != e['t'] and e['f'] in mine and e['t'] in mine
                    and e['f'] not in steps and e['t'] not in steps):
                succ[e['f']].append(e['t'])
                pred[e['t']].append(e['f'])
        linked = [u for u in ids if succ[u] or pred[u]]
        layer, dag = _layers(linked, succ)
        depth = max(layer.values(), default=-1) + 1
        layers = [[] for _ in range(depth)]
        seen = set()

        def walk(u):
            seen.add(u)
            layers[layer[u]].append(u)
            for v in sorted(dag[u]):
                if v not in seen:
                    walk(v)

        for u in linked:
            if not pred[u] and u not in seen:
                walk(u)
        for u in linked:
            if u not in seen:
                walk(u)

        for L in layers:
            for i, u in enumerate(L):
                x[u] = mid + (i - (len(L) - 1) / 2) * gap
        for _ in range(6):
            for L in layers:
                want = {u: _mean([x[v] for v in pred[u] + succ[u] if v in x], x[u]) for u in L}
                L.sort(key=lambda u: want[u])
                rows = [L[i:i + cap] for i in range(0, len(L), cap)]
                for r in rows:
                    x.update(_compact(r, want, gap, lo, hi))

        rows = []
        for L in layers:
            rows += [L[i:i + cap] for i in range(0, len(L), cap)]
        band_rows[bi] = (rows, [u for u in ids if u not in layer])

    for bi, b in enumerate(rules['bands']):
        rows, loose = band_rows[bi]
        want = {u: _mean([x[v] for v, _ in nbrs[u] if v in x], mid) for u in loose}
        groups = defaultdict(list)
        for u in loose:
            groups[kind_rank.get(kind_of[u], len(kind_rank))].append(u)
        # Unlinked entries fill rows by the width of their names (readable at about 60% zoom), not by a fixed count,
        # each kept as close to its linked neighbours as the names beside it allow.
        width = {u: (len(labels[u]) * 7 + 12) / 0.6 + 16 for u in loose}
        for k in sorted(groups):
            g = sorted(groups[k], key=lambda u: want[u])
            n_rows = math.ceil(sum(width[u] for u in g) / (hi - lo))
            per = math.ceil(len(g) / n_rows)
            for i in range(0, len(g), per):
                r = g[i:i + per]
                x.update(zip(r, _spread([want[u] for u in r], [width[u] for u in r], lo, hi)))
                rows.append(r)

    for bi, b in enumerate(rules['bands']):
        rows, _ = band_rows[bi]
        xs = [x[u] for r in rows for u in r]
        if len(xs) > 1 and max(xs) > min(xs):
            c, s = (min(xs) + max(xs)) / 2, min(rules['maxStretch'], (hi - lo) / (max(xs) - min(xs)))
            for r in rows:
                for u in r:
                    x[u] = mid + (x[u] - c) * s

    y, bands, top = {}, [], 0
    for bi, b in enumerate(rules['bands']):
        rows, _ = band_rows[bi]
        y0 = top
        for i, r in enumerate(rows):
            for u in r:
                y[u] = y0 + sp['head'] + i * sp['row']
        y1 = y0 + sp['head'] + max(len(rows) - 1, 0) * sp['row'] + sp['foot']
        bands.append({**b, 'y0': y0, 'y1': y1, 'stories': stories[bi]})
        top = y1

    rail = rules['rail']
    rx = W + rail['width'] / 2
    gods = [n['id'] for n in nodes if n['yuga'] == rail['period']]
    want = {u: _mean([y[v] for v, _ in nbrs[u] if v in y], top / 2) for u in gods}
    gods.sort(key=lambda u: want[u])
    ys = _compact(gods, want, rail['gap'], sp['head'], top - sp['foot'])
    for u in gods:
        x[u], y[u] = rx, ys[u]

    # A step is not drawn; it sits at the centre of its people, so selecting it brings them into view.
    for b in bands:
        band_mid = (b['y0'] + b['y1']) / 2
        for u in b['stories']:
            near = [v for v, _ in nbrs[u] if v in x and v in y and kind_of[v] != 'story']
            x[u], y[u] = _mean([x[v] for v in near], mid), _mean([y[v] for v in near], band_mid)

    return {
        'W': W + rail['width'], 'H': top, 'head': sp['head'], 'bands': bands,
        'rail': {'x0': W, 'x1': W + rail['width'], 'name': rail['name']},
        'positions': {u: [round(x[u], 1), round(y[u], 1)] for u in x},
    }
