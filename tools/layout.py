"""Type-rule layout: periods as stacked bands, lineage layers inside each band, rows bounded to a fixed width."""
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

    x, row_of, band_rows = {}, {}, {}
    for b in rules['bands']:
        p = b['period']
        ids = sorted(n['id'] for n in nodes if n['yuga'] == p)
        succ, pred = defaultdict(list), defaultdict(list)
        for e in edges:
            if e['type'] in layer_types and e['f'] != e['t'] and period_of[e['f']] == p == period_of[e['t']]:
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
        band_rows[p] = (rows, [u for u in ids if u not in layer])

    for b in rules['bands']:
        rows, loose = band_rows[b['period']]
        want = {u: _mean([x[v] for v, _ in nbrs[u] if v in x], mid) for u in loose}
        groups = defaultdict(list)
        for u in loose:
            groups[kind_rank.get(kind_of[u], len(kind_rank))].append(u)
        for k in sorted(groups):
            g = sorted(groups[k], key=lambda u: want[u])
            for i in range(0, len(g), cap):
                r = g[i:i + cap]
                x.update(_compact(r, want, gap, lo, hi))
                rows.append(r)

    for b in rules['bands']:
        rows, _ = band_rows[b['period']]
        xs = [x[u] for r in rows for u in r]
        if len(xs) > 1 and max(xs) > min(xs):
            c, s = (min(xs) + max(xs)) / 2, min(rules['maxStretch'], (hi - lo) / (max(xs) - min(xs)))
            for r in rows:
                for u in r:
                    x[u] = mid + (x[u] - c) * s

    y, bands, top = {}, [], 0
    for b in rules['bands']:
        rows, _ = band_rows[b['period']]
        y0 = top
        for i, r in enumerate(rows):
            for u in r:
                y[u] = y0 + sp['head'] + i * sp['row']
        y1 = y0 + sp['head'] + max(len(rows) - 1, 0) * sp['row'] + sp['foot']
        bands.append({**b, 'y0': y0, 'y1': y1})
        top = y1

    rail = rules['rail']
    rx = W + rail['width'] / 2
    gods = [n['id'] for n in nodes if n['yuga'] == rail['period']]
    want = {u: _mean([y[v] for v, _ in nbrs[u] if v in y], top / 2) for u in gods}
    gods.sort(key=lambda u: want[u])
    ys = _compact(gods, want, rail['gap'], sp['head'], top - sp['foot'])
    for u in gods:
        x[u], y[u] = rx, ys[u]

    return {
        'W': W + rail['width'], 'H': top, 'head': sp['head'], 'bands': bands,
        'rail': {'x0': W, 'x1': W + rail['width'], 'name': rail['name']},
        'positions': {u: [round(x[u], 1), round(y[u], 1)] for u in x},
    }
