# Atlas of Ages

[![Check and deploy](https://github.com/SuperBoar-Games/atlas-of-ages/actions/workflows/pages.yml/badge.svg)](https://github.com/SuperBoar-Games/atlas-of-ages/actions/workflows/pages.yml)

Indian sacred history from creation to 1947, as a graph of who is linked to whom and a map of where they were.
The data is RDF in `graph/`; the site is built from it.

## Run

```sh
uv sync
uv run python tools/dev.py                    # http://127.0.0.1:8000, rebuilds on change
```

## Build

```sh
uv run python tools/build.py check            # validate
uv run python tools/build.py build            # validate and build dist/
uv run python tools/build.py build --quick    # build the site only, no validation
uv run python tools/build.py build --out DIR  # build into DIR
```

## Data

```sh
uv run python tools/wikidata.py fetch         # refresh graph/wikidata.ttl
uv run python tools/basemap.py                # refresh basemap/world.json
uv run python tools/territories.py            # refresh basemap/territories.json
```

Namespace `https://w3id.org/atlas-of-ages#`. Territories from Cliopatria (Seshat, CC BY 4.0); basemap from Natural Earth.
