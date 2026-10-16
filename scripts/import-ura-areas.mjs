/** Build a project catalogue from URA's official API or a saved URA JSON export.
 * No credentials are written to SQL; no rental prices or individual units retained.
 * Usage: URA_ACCESS_KEY=... node scripts/import-ura-areas.mjs --output ura-areas.sql
 *        node scripts/import-ura-areas.mjs --input export.json --output ura-areas.sql
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function normalizeProjects(payloads){
 const projects=new Map();
 for(const payload of payloads){
  if(payload.Status!=='Success'||!Array.isArray(payload.Result))throw Error('Expected a successful URA data-service response');
  for(const row of payload.Result){
   if(typeof row.project!=='string'||!row.project.trim()||typeof row.street!=='string')continue;
   const name=row.project.trim().replace(/\s+/g,' '),street=row.street.trim().replace(/\s+/g,' ');
   const records=row.rentalMedian||row.rental||row.transaction||[];
   const district=records.map(r=>String(r.district||'').padStart(2,'0')).find(d=>/^\d{2}$/.test(d)&&Number(d)>=1&&Number(d)<=28);
   // Never group unknown projects into an artificial 'Singapore' neighbourhood.
   if(!district)continue;
   const key=(name+'|'+street).toUpperCase(),id='ura-'+createHash('sha256').update(key).digest('hex').slice(0,20);
   projects.set(key,{id,name,neighbourhood:'Postal district '+district,street});
  }
 }
 return [...projects.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export function toSQL(projects){return ['-- Source: URA Data Service. Generated '+new Date().toISOString().slice(0,10), '-- Project catalogue only; rental-based coverage is not exhaustive.', '-- Postal district groups are coarse and are not precise distance matching.', ...projects.map(p=>`INSERT INTO areas(id,name,neighbourhood) VALUES(${quote(p.id)},${quote(p.name)},${quote(p.neighbourhood)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,neighbourhood=excluded.neighbourhood;`),''].join('\n')}
async function main(){const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];let payloads;
 if(args.includes('--input')){const data=JSON.parse(await readFile(arg('--input'),'utf8'));payloads=Array.isArray(data)?data:[data]}
 else {const key=process.env.URA_ACCESS_KEY;if(!key)throw Error('Set URA_ACCESS_KEY or supply --input with a saved official URA response.');
  const tokenResponse=await fetch('https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1',{headers:{AccessKey:key}});if(!tokenResponse.ok)throw Error('URA token request failed');const token=await tokenResponse.json();if(token.Status!=='Success'||!token.Result)throw Error('URA did not issue a token');
  const response=await fetch('https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Rental_Median',{headers:{AccessKey:key,Token:token.Result}});if(!response.ok)throw Error('URA project request failed');payloads=[await response.json()];
 }
 const projects=normalizeProjects(payloads);if(!projects.length)throw Error('No valid projects found. Existing database left untouched.');const output=args.includes('--output')?arg('--output'):'ura-areas.sql';await writeFile(output,toSQL(projects));console.log(`Prepared ${projects.length} projects in ${output}. Review, then import with wrangler d1 execute. No database was modified.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
