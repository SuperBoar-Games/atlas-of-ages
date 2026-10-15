import { buildModel } from './common.js';
import { initTheme } from './theme.js';
import { startGraph } from './page_graph.js';
import { startMap } from './page_map.js';

const $ = id => document.getElementById(id);
const model = buildModel(await (await fetch('data.json')).json());
const graph = startGraph(model);
// The map loads its basemap on first visit, so the graph opens without waiting for it.
let map = null;
initTheme($('themeBtn'), () => { graph.themeChanged(); map?.themeChanged(); });
graph.start();

// A reload (the dev server's live reload included) comes back to the same view, place and selection.
const SAVED = 'aoa-view';
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem(SAVED) || 'null'); } catch {}
addEventListener('beforeunload', () => {
  try { sessionStorage.setItem(SAVED, JSON.stringify({ graph: graph.state(), map: map ? map.state() : saved?.map })); } catch {}
});
if (saved?.graph) graph.restore(saved.graph);

let view = null;
async function route() {
  const next = location.hash === '#map' ? 'map' : 'graph';
  if (next === view) return;
  view = next;
  if (next === 'map' && !map) map = startMap(model, await (await fetch('basemap.json')).json());
  document.body.classList.toggle('view-map', next === 'map');
  for (const [id, v] of [['viewGraph', 'graph'], ['viewMap', 'map']]) {
    if (v === next) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  graph.show(next === 'graph');
  map?.show(next === 'map');
  if (next === 'map' && saved?.map) { map.restore(saved.map); saved.map = null; }
}
addEventListener('hashchange', route);
await route();

// The help line goes at the first scroll, click or key, or after a few seconds, so it never sits over the graph.
const hideHint = () => { $('hint').hidden = true; };
for (const t of ['wheel', 'pointerdown', 'keydown']) addEventListener(t, hideHint, { once: true, passive: true });
setTimeout(hideHint, 8000);

const current = () => view === 'map' ? map : graph;
$('zin').onclick = () => current().zoom(1.3);
$('zout').onclick = () => current().zoom(1 / 1.3);
$('zfit').onclick = () => current().fit();
// A name in the map panel opens that entry in the graph.
$('mapPanel').addEventListener('click', ev => {
  const b = ev.target.closest('[data-graph]');
  if (!b) return;
  location.hash = '#graph';
  graph.open(b.dataset.graph);
});
