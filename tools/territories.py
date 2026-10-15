"""Extract the territories of the historical polities in graph/polities.ttl from Seshat's Cliopatria and write basemap/territories.json."""
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from rdflib import RDF, Graph, Namespace
from rdflib.namespace import SKOS

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'basemap' / 'territories.json'
AOA = Namespace('https://w3id.org/atlas-of-ages#')
WD = 'http://www.wikidata.org/entity/'
URL = 'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.1/cliopatria.geojson.zip'
SOURCE = ('Cliopatria v0.2.1 (CC BY 4.0): Bennett et al., "Cliopatria - A geospatial database of world-wide political entities '
          'from 3400BCE to 2024CE", Scientific Data 12, 247 (2025), doi:10.1038/s41597-025-04516-9. Outer rings only, rounded to 0.01°.')
# Cliopatria splits Magadha by dynasty and has Company territory only as the British Empire.
ALSO = {'Q234009': {'Q12459974', 'Q972165'}, 'Q2001966': {'Q8680'}}
# The British Empire feature is worldwide; keep the parts whose first point is in South Asia.
SOUTH_ASIA = (60, 0, 100, 38)


def ccw(ring):
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))
    return ring if area > 0 else ring[::-1]


def rnd(pts):
    out = []
    for x, y in pts:
        q = [round(x, 2), round(y, 2)]
        if not out or q != out[-1]:
            out.append(q)
    return out


def main():
    g = Graph()
    for f in ('polities.ttl', 'identifiers.ttl'):
        g.parse(ROOT / 'graph' / f)
    ours = {}
    for s in g.subjects(RDF.type, AOA.Polity):
        for m in g.objects(s, SKOS.exactMatch):
            q = str(m).removeprefix(WD)
            for qid in {q} | ALSO.get(q, set()):
                ours.setdefault(qid, set()).add(str(s).removeprefix(str(AOA)))
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    raw = path.read_bytes() if path else urllib.request.urlopen(urllib.request.Request(URL, headers={'User-Agent': 'atlas-of-ages'}), timeout=600).read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        data = json.loads(z.read(next(n for n in z.namelist() if n.endswith('.geojson'))))
    out = {}
    for f in data['features']:
        p = f['properties']
        whos = ours.get(p.get('Wikidata'))
        # "British Colonial Empire" shares the British Empire's id and spans 1706-1999; only the Company-era rows apply.
        # The janapadas are uniform ~5,000 km² placeholders, not mapped extents; graph/extents.ttl draws those.
        if (p['Type'] != 'POLITY' or not whos or not f['geometry'] or p['Name'] == 'British Colonial Empire'
                or p['Name'].startswith('Janapada of')):
            continue
        g_ = f['geometry']
        polys = g_['coordinates'] if g_['type'] == 'MultiPolygon' else [g_['coordinates']]
        x0, y0, x1, y1 = SOUTH_ASIA
        rings = [ccw(r) for poly in polys if len(r := rnd(poly[0])) > 3 and x0 <= r[0][0] <= x1 and y0 <= r[0][1] <= y1]
        for who in whos if rings else ():
            out.setdefault(who, []).append({'from': p['FromYear'], 'to': p['ToYear'], 'rings': rings, 'composite': p['Name'].startswith('(')})
    # A composite "(Name)" overlaps its own rows; it stands in only where there are none, as for the Delhi Sultanate.
    for who, rows in out.items():
        plain = [r for r in rows if not r['composite']] or rows
        out[who] = sorted(({k: v for k, v in r.items() if k != 'composite'} for r in plain), key=lambda r: r['from'])
    OUT.write_text(json.dumps({'source': SOURCE, 'polities': out}, separators=(',', ':')) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB, ' + ', '.join(f'{k} {len(v)}' for k, v in sorted(out.items())))
    missing = sorted(set().union(*ours.values()) - set(out))
    if missing:
        print(f'not in Cliopatria: {", ".join(missing)}')


if __name__ == '__main__':
    main()
