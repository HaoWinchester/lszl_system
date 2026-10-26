// Reuse the shared authoring pipeline; existing PMP graph/package bytes are immutable.
import {parseTopics,buildCatalog} from '../shared/authoring.mjs';
import {fileURLToPath} from 'node:url';
const directory=new URL('./',import.meta.url);
const {catalog}=await buildCatalog({directory,expectedCount:30},parseTopics(fileURLToPath(directory)));
console.log(JSON.stringify({graphs:catalog.graphCount,nodes:catalog.nodeCount,links:catalog.linkCount}));
