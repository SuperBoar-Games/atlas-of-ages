import { buildModel } from './common.js';
import { initTheme } from './theme.js';
import { startGraph } from './page_graph.js';

const data = await (await fetch('data.json')).json();
const graph = startGraph(buildModel(data));
initTheme(document.getElementById('themeBtn'), () => graph.themeChanged());
graph.start();
