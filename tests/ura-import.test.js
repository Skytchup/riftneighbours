import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProjects,toSQL} from '../scripts/import-ura-areas.mjs';
test('URA catalogue deduplicates names, requires district and retains no contract details',()=>{const result=normalizeProjects([{Status:'Success',Result:[{project:"O'NEIL COURT",street:'EXAMPLE ROAD',rentalMedian:[{district:'5',median:999}]},{project:"o'neil court",street:'example road',rental:[{district:'05',rent:999}]},{project:'Unknown district',street:'OTHER ROAD',rental:[]}]}]);assert.equal(result.length,1);assert.equal(result[0].neighbourhood,'Postal district 05');assert.equal(result[0].rent,undefined);assert.match(toSQL(result),/o''neil court/);assert.doesNotMatch(toSQL(result),/999/)});
test('failed URA response cannot replace catalogue',()=>{assert.throws(()=>normalizeProjects([{Status:'Failure',Result:[]}]))});
