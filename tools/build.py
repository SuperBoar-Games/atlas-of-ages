"""Validate the Yugachakra graph and build the web page from it."""
import argparse
import json
import re
import sys
from pathlib import Path

from pyshacl import validate
from rdflib import RDF, RDFS, Graph, Namespace, URIRef
from rdflib.namespace import DCTERMS

ROOT = Path(__file__).resolve().parent.parent
YC = Namespace('https://w3id.org/yugachakra#')
SCHEMA = Namespace('https://schema.org/')
KINDS = [YC.Deva, YC.Avatar, YC.Sage, YC.Person, YC.Event, YC.Story]
# Citation order in the panel: Valmiki by kanda, Uttara Kanda, Mahabharata and Vishnu Purana, Bhagavata.
CITE_ORDER = ['valmikiramayan.net/baala', 'valmikiramayan.net/ayodhya', 'valmikiramayan.net/aranya', 'valmikiramayan.net/kish',
              'valmikiramayan.net/sundara', 'valmikiramayan.net/yuddha', 'wisdomlib.org', 'sacred-texts.com/book',
              'sacred-texts.com/hin', 'gutenberg.org', 'vedabase.io']


def load():
    data = Graph()
    data.parse(ROOT / 'ontology' / 'yc.ttl')
    for f in sorted((ROOT / 'graph').glob('*.ttl')):
        data.parse(f)
    shapes = Graph().parse(ROOT / 'shapes' / 'yc-shapes.ttl')
    layout = json.loads((ROOT / 'layout' / 'layout.json').read_text())
    return data, shapes, layout


def local(iri):
    return str(iri).removeprefix(str(YC))


def check(data, shapes, layout):
    conforms, _, report = validate(data, shacl_graph=shapes, inference='none', abort_on_first=False)
    errors = [] if conforms else [report]
    vocab = Graph().parse(ROOT / 'ontology' / 'yc.ttl')
    terms = {s for s in vocab.subjects() if isinstance(s, URIRef)}
    entries = set(data.subjects(YC.period, None))
    errors += [f'entry id clashes with a vocabulary term: {local(e)}' for e in entries & terms]
    ids = {local(e) for e in entries}
    pos = set(layout['positions'])
    errors += [f'no position in layout.json: {i}' for i in sorted(ids - pos)]
    errors += [f'position for unknown entry: {i}' for i in sorted(pos - ids)]
    errors += [f'labelRight names unknown entry: {i}' for i in layout['labelRight'] if i not in ids]
    return errors


def cite_key(c):
    label, url = c
    rank = next((i for i, p in enumerate(CITE_ORDER) if p in url), len(CITE_ORDER))
    return rank, [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', label)]


def to_json(data, layout):
    key = {s: str(o) for s, o in data.subject_objects(YC.key)}
    relations = set(data.subjects(RDF.type, YC.Relation))
    pos, right = layout['positions'], set(layout['labelRight'])
    nodes = []
    for e in sorted(data.subjects(YC.period, None), key=local):
        types = set(data.objects(e, RDF.type))
        period = key[data.value(e, YC.period)]
        tier = data.value(e, YC.tier)
        tier = key[tier] if tier else None
        cites = [(str(data.value(c, RDFS.label)), str(data.value(c, SCHEMA.url))) for c in data.objects(e, DCTERMS.source)]
        being = data.value(e, YC.being)
        i = local(e)
        nodes.append({
            'id': i, 'label': str(data.value(e, RDFS.label)), 'yuga': period,
            'x': pos[i][0], 'y': pos[i][1], 'kind': key[next(k for k in KINDS if k in types)],
            'desc': str(data.value(e, RDFS.comment)),
            'later': tier in ('purana', 'folk'), 'right': i in right,
            'tier': 'history' if period == 'history' else tier,
            'span': bool(types & {YC.SpansYugas, YC.Chiranjivi}), 'chiranjivi': YC.Chiranjivi in types,
            'catastrophe': YC.Catastrophe in types,
            'being': key[being] if being else None,
            'roles': sorted(key[r] for r in data.objects(e, YC.role)),
            'sources': sorted(cites, key=cite_key),
        })
    edges = []
    for s, p, o in data:
        if p in relations:
            edges.append({'f': local(s), 't': local(o), 'type': key[p], 'own': 'core'})
    for ln in data.subjects(RDF.type, YC.Link):
        tier = data.value(ln, YC.tier)
        e = {'f': local(data.value(ln, YC['from'])), 't': local(data.value(ln, YC.to)),
             'type': key[data.value(ln, YC.relation)], 'own': key[tier] if tier else 'core'}
        for k, prop in (('l', YC.forwardLabel), ('r', YC.reverseLabel)):
            v = data.value(ln, prop)
            if v is not None:
                e[k] = str(v)
        edges.append(e)
    edges.sort(key=lambda e: (e['f'], e['type'], e['t']))
    return {'layout': {**layout['canvas'], 'BANDS': layout['bands'], 'HISTORY': layout['history'],
                       'CAPTIONS': layout['captions'], 'ERAS': layout['eras']},
            'nodes': nodes, 'edges': edges}


def materialize(data):
    out = Graph()
    for prefix, ns in data.namespaces():
        out.bind(prefix, ns)
    out += data
    for ln in data.subjects(RDF.type, YC.Link):
        out.add((data.value(ln, YC['from']), data.value(ln, YC.relation), data.value(ln, YC.to)))
    return out


def page(graph_json):
    web = ROOT / 'web'
    html = (web / 'index.html').read_text()
    blob = json.dumps(graph_json, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    parts = {
        '<link rel="stylesheet" href="style.css">': f"<style>\n{(web / 'style.css').read_text()}</style>",
        '<script src="data.js"></script>': f'<script>const DATA = {blob};</script>',
        '<script src="app.js"></script>': f"<script>\n{(web / 'app.js').read_text()}</script>",
    }
    for tag, inline in parts.items():
        if tag not in html:
            sys.exit(f'web/index.html is missing {tag}')
        html = html.replace(tag, inline)
    return html


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['check', 'build'])
    ap.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = ap.parse_args()
    data, shapes, layout = load()
    errors = check(data, shapes, layout)
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    n_entries = len(set(data.subjects(YC.period, None)))
    print(f'ok: {n_entries} entries, {len(data)} triples')
    if args.command == 'check':
        return
    g = to_json(data, layout)
    args.out.mkdir(exist_ok=True)
    (args.out / 'graph.json').write_text(json.dumps(g, ensure_ascii=False, indent=1) + '\n')
    (args.out / 'index.html').write_text(page(g))
    full = materialize(data)
    full.serialize(args.out / 'yugachakra.ttl', format='turtle')
    full.serialize(args.out / 'yugachakra.jsonld', format='json-ld', auto_compact=True)
    print(f"built {args.out}: {len(g['nodes'])} nodes, {len(g['edges'])} edges")


if __name__ == '__main__':
    main()
