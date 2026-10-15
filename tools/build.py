"""Validate the Atlas of Ages graph and build the web page from it."""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

from pyshacl import validate
from rdflib import RDF, RDFS, Graph, Namespace, URIRef
from rdflib.namespace import DCTERMS, SKOS

from layout import layout as place

ROOT = Path(__file__).resolve().parent.parent
AOA = Namespace('https://w3id.org/atlas-of-ages#')
SCHEMA = Namespace('https://schema.org/')
GEO = Namespace('http://www.opengis.net/ont/geosparql#')
TIME = Namespace('http://www.w3.org/2006/time#')
KINDS = [AOA.Deva, AOA.Avatar, AOA.Sage, AOA.Person, AOA.Event, AOA.Story]
# Citation order in the panel: Valmiki by kanda, Uttara Kanda, Mahabharata and Vishnu Purana, Bhagavata.
CITE_ORDER = ['valmikiramayan.net/baala', 'valmikiramayan.net/ayodhya', 'valmikiramayan.net/aranya', 'valmikiramayan.net/kish',
              'valmikiramayan.net/sundara', 'valmikiramayan.net/yuddha', 'wisdomlib.org', 'sacred-texts.com/book',
              'sacred-texts.com/hin', 'gutenberg.org', 'vedabase.io']


def load():
    data = Graph()
    data.parse(ROOT / 'ontology' / 'aoa.ttl')
    for f in sorted((ROOT / 'graph').glob('*.ttl')):
        data.parse(f)
    shapes = Graph().parse(ROOT / 'shapes' / 'aoa-shapes.ttl')
    layout = json.loads((ROOT / 'layout' / 'layout.json').read_text())
    return data, shapes, layout


def local(iri):
    return str(iri).removeprefix(str(AOA))


def graph_entries(data):
    """Figures and occurrences; polities also carry a period but are not graph entries."""
    return {s for s in data.subjects(AOA.period, None) if any((s, RDF.type, k) in data for k in KINDS)}


def check(data, shapes, layout):
    conforms, _, report = validate(data, shacl_graph=shapes, inference='none', abort_on_first=False)
    errors = [] if conforms else [report]
    vocab = Graph().parse(ROOT / 'ontology' / 'aoa.ttl')
    terms = {s for s in vocab.subjects() if isinstance(s, URIRef)}
    entries = graph_entries(data)
    errors += [f'entry id clashes with a vocabulary term: {local(e)}' for e in entries & terms]
    key = {s: str(o) for s, o in data.subject_objects(AOA.key)}
    placed = {b['period'] for b in layout['bands']} | {layout['rail']['period']}
    used = {key[p] for p in data.objects(None, AOA.period)}
    errors += [f'layout.json has no band for period: {p}' for p in sorted(used - placed)]
    return errors


def cite_key(c):
    label, url = c
    rank = next((i for i, p in enumerate(CITE_ORDER) if p in url), len(CITE_ORDER))
    return rank, [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', label)]


def to_json(data, layout):
    key = {s: str(o) for s, o in data.subject_objects(AOA.key)}
    relations = set(data.subjects(RDF.type, AOA.Relation))
    nodes = []
    for e in sorted(graph_entries(data), key=local):
        types = set(data.objects(e, RDF.type))
        period = key[data.value(e, AOA.period)]
        tier = data.value(e, AOA.tier)
        tier = key[tier] if tier else None
        cites = [(str(data.value(c, RDFS.label)), str(data.value(c, SCHEMA.url))) for c in data.objects(e, DCTERMS.source)]
        being = data.value(e, AOA.being)
        i = local(e)
        nodes.append({
            'id': i, 'label': str(data.value(e, RDFS.label)), 'yuga': period,
            'kind': key[next(k for k in KINDS if k in types)],
            'desc': str(data.value(e, RDFS.comment)),
            'later': tier in ('purana', 'folk'),
            'tier': 'history' if period == 'history' else tier,
            'span': bool(types & {AOA.SpansYugas, AOA.Chiranjivi}), 'chiranjivi': AOA.Chiranjivi in types,
            'catastrophe': AOA.Catastrophe in types,
            'being': key[being] if being else None,
            'roles': sorted(key[r] for r in data.objects(e, AOA.role)),
            'sources': sorted(cites, key=cite_key),
            'years': years(data, data.value(e, AOA.when)),
            'era': key.get(data.value(e, AOA.era)),
        })
    edges = []
    for s, p, o in data:
        if p in relations:
            edges.append({'f': local(s), 't': local(o), 'type': key[p], 'own': 'core'})
    for ln in data.subjects(RDF.type, AOA.Link):
        tier = data.value(ln, AOA.tier)
        e = {'f': local(data.value(ln, AOA['from'])), 't': local(data.value(ln, AOA.to)),
             'type': key[data.value(ln, AOA.relation)], 'own': key[tier] if tier else 'core'}
        for k, prop in (('l', AOA.forwardLabel), ('r', AOA.reverseLabel)):
            v = data.value(ln, prop)
            if v is not None:
                e[k] = str(v)
        edges.append(e)
    edges.sort(key=lambda e: (e['f'], e['type'], e['t']))
    placed = place(nodes, edges, layout)
    pos = placed.pop('positions')
    for n in nodes:
        n['x'], n['y'] = pos[n['id']]
    places = []
    for p in sorted(data.subjects(RDF.type, AOA.Place), key=local):
        geom = data.value(p, GEO.hasGeometry)
        wkt = str(data.value(geom, GEO.asWKT)) if geom else None
        lon, lat = (float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', wkt)[:2]) if wkt else (None, None)
        modern = data.value(p, AOA.modernName)
        names = [{'name': str(data.value(r, RDFS.label)), 'periods': sorted(key[x] for x in data.objects(r, AOA.period)),
                  'years': years(data, data.value(r, AOA.when))} for r in data.objects(p, AOA.nameDuring)]
        places.append({'id': local(p), 'label': str(data.value(p, RDFS.label)), 'kind': key[data.value(p, AOA.placeKind)],
                       'identification': key[data.value(p, AOA.identification)], 'lon': lon, 'lat': lat,
                       'modern': str(modern) if modern else None, 'names': names})
    polities = [{'id': local(q), 'label': str(data.value(q, RDFS.label)),
                 'periods': sorted(key[x] for x in data.objects(q, AOA.period)), 'years': years(data, data.value(q, AOA.when)),
                 'places': sorted(local(p) for p in data.subjects(AOA.locatedIn, q)), 'extent': extent(data, q)}
                for q in sorted(data.subjects(RDF.type, AOA.Polity), key=local)]
    # An attestation is no more canonical than its entry, as a link is no more canonical than its ends.
    rank = ['core', 'layer', 'vulgate', 'purana', 'folk']
    entry_tier = {n['id']: n['tier'] for n in nodes}
    attestations = []
    for a in data.subjects(RDF.type, AOA.Attestation):
        tier, period, who = data.value(a, AOA.tier), data.value(a, AOA.period), local(data.value(a, AOA.who))
        own, of_entry = key[tier] if tier else 'core', entry_tier.get(who)
        # A dated attestation is a historical record, even of an entry placed in an age (the Vedas' composition).
        dated = data.value(a, AOA.when) is not None
        tier = None if (of_entry == 'history' or dated) and not tier else rank[max(rank.index(own), rank.index(of_entry) if of_entry in rank else 0)]
        attestations.append({'who': who, 'does': key[data.value(a, AOA.does)], 'where': local(data.value(a, AOA.where)),
                             'tier': tier, 'period': key[period] if period else None,
                             'years': years(data, data.value(a, AOA.when))})
    attestations.sort(key=lambda a: (a['who'], a['does'], a['where']))
    eras = sorted(({'key': key[c], 'label': str(data.value(c, SKOS.prefLabel)),
                    'from': float(data.value(c, AOA.yearsAgoFrom)), 'to': float(data.value(c, AOA.yearsAgoTo))}
                   for c in data.subjects(SKOS.inScheme, AOA.Eras)), key=lambda x: -x['from'])
    return {'layout': placed, 'nodes': nodes, 'edges': edges, 'places': places, 'attestations': attestations,
            'polities': polities, 'eras': eras}


def extent(data, polity):
    """The outer ring of a polity's WKT polygon as [lon, lat] pairs, counter-clockwise, or None."""
    geom = data.value(polity, GEO.hasGeometry)
    if geom is None:
        return None
    nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', str(data.value(geom, GEO.asWKT)))]
    ring = [[x, y] for x, y in zip(nums[::2], nums[1::2])][:-1]
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))
    return ring if area > 0 else ring[::-1]


def years(data, interval):
    """[begin, end] as astronomical years (0 is 1 BCE), or None."""
    if interval is None:
        return None
    ends = [data.value(data.value(interval, p), TIME.inXSDgYear) for p in (TIME.hasBeginning, TIME.hasEnd)]
    ys = [int(str(v)) if v is not None else None for v in ends]
    return None if ys == [None, None] else [ys[0] if ys[0] is not None else ys[1], ys[1] if ys[1] is not None else ys[0]]


def materialize(data):
    out = Graph()
    for prefix, ns in data.namespaces():
        out.bind(prefix, ns)
    out += data
    for ln in data.subjects(RDF.type, AOA.Link):
        out.add((data.value(ln, AOA['from']), data.value(ln, AOA.relation), data.value(ln, AOA.to)))
    return out


def site(graph_json, out):
    shutil.copytree(ROOT / 'web', out, dirs_exist_ok=True)
    basemap = json.loads((ROOT / 'basemap' / 'world.json').read_text())
    basemap['territories'] = json.loads((ROOT / 'basemap' / 'territories.json').read_text())
    (out / 'basemap.json').write_text(json.dumps(basemap, separators=(',', ':')))
    (out / 'data.json').write_text(json.dumps(graph_json, ensure_ascii=False, separators=(',', ':')))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['check', 'build'])
    ap.add_argument('--out', type=Path, default=ROOT / 'dist')
    ap.add_argument('--quick', action='store_true', help='skip SHACL and the RDF exports (dev server)')
    args = ap.parse_args()
    data, shapes, layout = load()
    if not args.quick:
        errors = check(data, shapes, layout)
        if errors:
            print('\n'.join(errors), file=sys.stderr)
            sys.exit(1)
        n_entries = len(graph_entries(data))
        print(f'ok: {n_entries} entries, {len(data)} triples')
    if args.command == 'check':
        return
    g = to_json(data, layout)
    args.out.mkdir(exist_ok=True)
    site(g, args.out)
    if args.quick:
        print(f"built {args.out} (quick): {len(g['nodes'])} nodes, {len(g['edges'])} edges")
        return
    full = materialize(data)
    full.serialize(args.out / 'atlas-of-ages.ttl', format='turtle')
    full.serialize(args.out / 'atlas-of-ages.jsonld', format='json-ld', auto_compact=True)
    print(f"built {args.out}: {len(g['nodes'])} nodes, {len(g['edges'])} edges")


if __name__ == '__main__':
    main()
