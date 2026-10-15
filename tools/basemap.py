"""Fetch Natural Earth land, rivers and today's borders (public domain) for the whole world and write basemap/world.json."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'basemap' / 'world.json'
BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
LAND, RIVERS, BORDERS = 'ne_50m_land.geojson', 'ne_50m_rivers_lake_centerlines.geojson', 'ne_50m_admin_0_boundary_lines_land.geojson'


def fetch(name):
    req = urllib.request.Request(BASE + name, headers={'User-Agent': 'atlas-of-ages-basemap'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def rnd(pts):
    """Two decimals (about 1 km) is finer than any zoom the map allows; drop the repeats rounding creates."""
    out = []
    for x, y in pts:
        q = [round(x, 2), round(y, 2)]
        if not out or q != out[-1]:
            out.append(q)
    return out


def parts(geom, depth):
    """Flatten (Multi)Polygon rings or (Multi)LineString lines to lists of points."""
    coords = geom['coordinates']
    if geom['type'].startswith('Multi'):
        return [p for c in coords for p in (c if depth == 2 else [c])]
    return coords if depth == 2 else [coords]


def ccw(ring):
    """Counter-clockwise in lon/lat (positive shoelace area), so land lies left of the walk; the globe's horizon clipping relies on it."""
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))
    return ring if area > 0 else ring[::-1]


def layers(scale):
    name = lambda f: f.replace('50m', scale)
    land = [ccw(r) for f in fetch(name(LAND))['features'] for poly in (f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']])
            if len(r := rnd(poly[0])) > 3]
    rivers = [r for f in fetch(name(RIVERS))['features'] for line in parts(f['geometry'], 1) if len(r := rnd(line)) > 1]
    borders = [r for f in fetch(name(BORDERS))['features'] for line in parts(f['geometry'], 1) if len(r := rnd(line)) > 1]
    return {'land': land, 'rivers': rivers, 'borders': borders}


def main():
    OUT.parent.mkdir(exist_ok=True)
    # 1:110m for the whole globe, 1:50m once zoomed in: same look, far fewer points to project per frame.
    OUT.write_text(json.dumps({
        'source': 'Natural Earth 1:50m and 1:110m land, rivers and land boundaries (public domain), naturalearthdata.com, v5.1.2',
        'fine': layers('50m'), 'coarse': layers('110m'),
    }, separators=(',', ':')) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
