import {validateLayout} from '../shared/validate-layout.mjs';
import {fileURLToPath} from 'node:url';
const report=validateLayout(fileURLToPath(new URL('./',import.meta.url)));
console.log(JSON.stringify({graphs:report.totalGraphs,cardObstructions:report.cardObstructions,edgeCrossings:report.edgeCrossings}));
