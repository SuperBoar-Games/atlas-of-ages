# Yugachakra

A connected map of Indian sacred history, from creation through the four yugas to 1947: gods and avatars,
dynasties and sages, the Vedas, the two epics and recorded history. The graph is RDF; the web page is built from it.

## Layout

| Path | What it holds |
|---|---|
| `ontology/yc.ttl` | Vocabulary: entry classes, the 12 relation types, and SKOS schemes for periods, source tiers, beings and roles |
| `shapes/yc-shapes.ttl` | SHACL shapes every change must pass |
| `graph/*.ttl` | The data, one file per period. A figure's block also holds its plain outgoing links |
| `layout/layout.json` | Layout rules by type only (bands per period, which link types set layers, spacing); never per entry |
| `web/` | `index.html`, `style.css` and ES modules in `js/`: `app.js` (start-up), `common.js` (graph model: tiers, filters, highlights, search), `theme.js` (palette, light/dark), `page_graph.js` (the graph view). The page loads `data.json` from the build |
| `tools/build.py` | Validates, lays out, then writes `dist/` |
| `tools/layout.py` | The layout: period bands, lineage layers, barycentre ordering, rows wrapped at a fixed width |
| `tools/perf.py` | Frame-time test in headless Chromium |

Namespace: `https://w3id.org/yugachakra#`.

## Model

- An entry is a `yc:Figure` (`Deva`, `Avatar`, `Sage`, `Person`) or a `yc:Occurrence` (`Event`, `Story`),
  with `rdfs:label`, `rdfs:comment`, `yc:period`, and outside recorded history a `yc:tier`.
- Extra types mark `yc:Chiranjivi`, `yc:SpansYugas` and `yc:Catastrophe`.
- A plain link is one triple: `:ravana yc:kills :jatayu .`
- A link with its own tier, wording or sources is a `yc:Link` (W3C n-ary relation pattern):

  ```turtle
  [] a yc:Link ; yc:from :kubera ; yc:relation yc:linkedWith ; yc:to :ravana ;
      yc:forwardLabel "Gives up Lanka to, and later loses the Pushpaka to" ;
      yc:reverseLabel "Takes Lanka and the Pushpaka from" .
  ```

  The build adds the plain triple for every `yc:Link` in `dist/yugachakra.ttl`.
- A link's shown tier is the least canonical of its own tier and its two ends.
- Sources are `dcterms:source [ a yc:Citation ; rdfs:label "Bala 1.4" ; schema:url <...> ]`.

## Working on it

```sh
uv run python tools/build.py check          # SHACL validation and layout consistency
uv run python tools/build.py build          # check, then dist/: the site (web/ + data.json), yugachakra.ttl, yugachakra.jsonld
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

Pushes to `main` deploy `dist/` to GitHub Pages (`.github/workflows/pages.yml`); pull requests only build.
