# Atlas of Ages

A connected map of Indian sacred history, from creation through the four yugas to 1947: gods and avatars,
dynasties and sages, the Vedas, the two epics and recorded history. The graph is RDF; the web page is built from it.

## Layout

| Path | What it holds |
|---|---|
| `ontology/aoa.ttl` | Vocabulary: entry classes, the 12 relation types, and SKOS schemes for periods, source tiers, beings and roles |
| `shapes/aoa-shapes.ttl` | SHACL shapes every change must pass |
| `graph/*.ttl` | The data, one file per period. A figure's block also holds its plain outgoing links |
| `layout/layout.json` | Layout rules by type only (bands per period, which link types set layers, spacing); never per entry |
| `web/` | `index.html`, `style.css` and ES modules in `js/`: `app.js` (start-up, `#graph`/`#map` routing), `common.js` (graph model and the shared pan/zoom camera), `theme.js` (palette, light/dark), `page_graph.js` (the graph view), `page_map.js` (the map view). The page loads `data.json`, and `basemap.json` on the first map visit |
| `tools/build.py` | Validates, lays out, then writes `dist/` |
| `tools/layout.py` | The layout: period bands, lineage layers, barycentre ordering, rows wrapped at a fixed width |
| `tools/perf.py` | Frame-time test in headless Chromium |
| `tools/wikidata.py` | Finds Wikidata ids and writes `graph/wikidata.ttl` (coordinates, years) |
| `tools/basemap.py` | Writes `basemap/world.json`: Natural Earth land, rivers and today's borders (public domain) at 1:50m and 1:110m |
| `graph/polities.ttl` | Kingdoms and states: epic ones by age, historical ones linked to Wikidata for their years; territories by `aoa:locatedIn` |

Namespace: `https://w3id.org/atlas-of-ages#`.

## Model

- An entry is a `aoa:Figure` (`Deva`, `Avatar`, `Sage`, `Person`) or a `aoa:Occurrence` (`Event`, `Story`),
  with `rdfs:label`, `rdfs:comment`, `aoa:period`, and outside recorded history a `aoa:tier`.
- Extra types mark `aoa:Chiranjivi`, `aoa:SpansYugas` and `aoa:Catastrophe`.
- A plain link is one triple: `:ravana aoa:kills :jatayu .`
- A link with its own tier, wording or sources is a `aoa:Link` (W3C n-ary relation pattern):

  ```turtle
  [] a aoa:Link ; aoa:from :kubera ; aoa:relation aoa:linkedWith ; aoa:to :ravana ;
      aoa:forwardLabel "Gives up Lanka to, and later loses the Pushpaka to" ;
      aoa:reverseLabel "Takes Lanka and the Pushpaka from" .
  ```

  The build adds the plain triple for every `aoa:Link` in `dist/atlas-of-ages.ttl`.
- A link's shown tier is the least canonical of its own tier and its two ends.
- Sources are `dcterms:source [ a aoa:Citation ; rdfs:label "Bala 1.4" ; schema:url <...> ]`.
- Places are `aoa:Place` (a GeoSPARQL `geo:Feature`) with a kind and an identification (established, traditional,
  uncertain). Established places link to Wikidata with `skos:exactMatch`; epic places link the modern site tradition
  identifies them with by `skos:closeMatch`.
- `aoa:Attestation` puts an entry at a place (born, died, ruled from, lived, went to, took place, founded, capital),
  optionally with a tier, period or years.
- Years are OWL-Time intervals, `aoa:when [ time:hasBeginning [ time:inXSDgYear "-0303" ] ... ]`, astronomical
  numbering as in XSD and Wikidata (0 is 1 BCE, so -0303 is 304 BCE).
- `graph/identifiers.ttl` links entries to Wikidata by hand; `graph/wikidata.ttl` is generated from those links and
  holds coordinates, years, and birth and death places (P19, P20) as attestations; a birth place not yet in the graph
  is added unless it is a country, state or region, and a hand-written attestation of the same kind wins. Names a
  place bore in an age or span of years are in `graph/names.ttl`; ages before history are split into eras in
  `graph/eras.ttl`. Refresh it with `uv run python tools/wikidata.py fetch`; find ids with
  `tools/wikidata.py search NAME`.

## Working on it

```sh
uv run python tools/build.py check          # SHACL validation and layout consistency
uv run python tools/build.py build          # check, then dist/: the site (web/ + data.json), atlas-of-ages.ttl, atlas-of-ages.jsonld
uv run python tools/dev.py                  # dev server on http://127.0.0.1:8000: quick rebuild on change (no SHACL), reloads the browser
uv run python tools/perf.py                 # frame cost and smoothness for scroll, zoom, drag, selection; --shot PATH saves a screenshot
```

A new entry needs only its block in the right `graph/*.ttl`; the layout places it.

`perf.py` needs Chromium once: `uv run playwright install chromium-headless-shell`. It uses the machine GPU by default;
`--renderer software` runs SwiftShader as a slow-device worst case.

## Rendering

The page draws on one canvas. The graph is rendered into 512 px tiles per half-octave zoom level and cached, as map
engines do: panning moves bitmaps, zooming scales them until the gesture rests, and new tiles are drawn within a
3 ms per-frame budget plus idle prefetch. Labels are placed once per zoom level. Selection and hover are a live overlay.

The map (`#map`) is an orthographic globe opening on South Asia. Land rings are cut at the horizon and rejoined along
the rim (rings are stored counter-clockwise for this); lines behind the globe or off-screen are skipped by a bounding
cap per line, and the whole globe uses the 1:110m layers. A time slider walks the ages, then the years; places light up
when something is attested there, and kingdoms show an approximate extent around their places. Modern names and
borders are an overlay, off by default.

Pushes to `main` deploy `dist/` to GitHub Pages (`.github/workflows/pages.yml`); pull requests only build.
