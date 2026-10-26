import {buildCatalog} from '../shared/authoring.mjs';
import {config,topics} from './topics.mjs';
const {catalog}=await buildCatalog(config,topics);
console.log(JSON.stringify({graphs:catalog.graphCount,nodes:catalog.nodeCount,links:catalog.linkCount}));
