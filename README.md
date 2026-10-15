# Yugachakra

A connected map of Indian sacred history, from creation through the four yugas to 1947: gods and avatars,
dynasties and sages, the Vedas, the two epics and recorded history. The graph is RDF; the web page is built from it.

## Layout

| Path | What it holds |
|---|---|
| `ontology/yc.ttl` | Vocabulary: entry classes, the 12 relation types, and SKOS schemes for periods, source tiers, beings and roles |
| `shapes/yc-shapes.ttl` | SHACL shapes every change must pass |
| `graph/*.ttl` | The data, one file per period. A figure's block also holds its plain outgoing links |
| `layout/layout.json` | Canvas, bands, captions, era markers and the x/y of every entry. Not knowledge, so not RDF |
| `web/` | Page markup, styles and display code; reads the built `DATA` |
| `tools/build.py` | Validates, then writes `dist/` |

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
uv run python tools/build.py build          # check, then dist/index.html (single file), graph.json, yugachakra.ttl, yugachakra.jsonld
uv run python -m http.server -d dist 8000   # serve the build on http://localhost:8000
```

A new entry needs a block in the right `graph/*.ttl` and a position in `layout/layout.json`; `check` names anything missing.

Pushes to `main` deploy `dist/` to GitHub Pages (`.github/workflows/pages.yml`); pull requests only build.
