// Credentials and provider tokens stay in the Worker. Caches are bounded and
// per-isolate; a cold start simply authenticates again on the next search.
const services=new WeakMap();
const clean=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export class LocationError extends Error {}
export function oneMap(env) {
 if(services.has(env))return services.get(env);
 let token=null,pending=null;
 const queries=new Map();
 async function authenticate(){
  if(!env.ONEMAP_EMAIL||!env.ONEMAP_PASSWORD)throw new LocationError('Location search is not connected yet. Please try again later.');
  if(token&&token.expires>Date.now()+60000)return token.value;
  if(!pending)pending=(async()=>{
   const response=await fetch('https://www.onemap.gov.sg/api/auth/post/getToken',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.ONEMAP_EMAIL,password:env.ONEMAP_PASSWORD}),signal:AbortSignal.timeout(4000)});
   if(!response.ok)throw new LocationError('Location search could not connect to OneMap. Please try again later.');
   const data=await response.json(),expires=Number(data.expiry_timestamp)*1000;
   if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(expires)||expires<=Date.now()+60000)throw new LocationError('Location search is temporarily unavailable.');
   token={value:data.access_token,expires};return token.value;
  })().finally(()=>{pending=null});
  return pending;
 }
 async function search(query){
  const q=clean(query);
  if(q.length<3||q.length>100)throw new LocationError('Enter 3–100 characters of a place name or postal code.');
  const key=q.toLowerCase(),cached=queries.get(key);
  if(cached&&cached.expires>Date.now())return cached.results;
  try{
   const url=new URL('https://www.onemap.gov.sg/api/common/elastic/search');
   url.search=new URLSearchParams({searchVal:q,returnGeom:'Y',getAddrDetails:'Y',pageNum:'1'});
   let response;
   for(let attempt=0;attempt<2;attempt++){
    const value=await authenticate();
    response=await fetch(url,{headers:{Authorization:value},signal:AbortSignal.timeout(4000)});
    if(![401,403].includes(response.status))break;
    if(token?.value===value)token=null;
   }
   if(!response.ok)throw new LocationError(response.status===429?'OneMap is busy. Wait a moment and try again.':'Location search is temporarily unavailable.');
   const data=await response.json();
   if(!Array.isArray(data.results))throw new LocationError('Location search returned an unexpected response. Please try again.');
   const results=[],seen=new Set();
   for(const row of data.results.slice(0,50)){
    const building=clean(row.BUILDING),address=clean(row.ADDRESS),postal=/^\d{6}$/.test(row.POSTAL)?row.POSTAL:'';
    const latitude=Number(row.LATITUDE),longitude=Number(row.LONGITUDE);
    const hasGeometry=latitude>=1.1&&latitude<=1.5&&longitude>=103.5&&longitude<=104.5;
    // Named public areas and HDB meeting points need not have a building name.
    const name=building&&!['NIL','NA','N/A'].includes(building.toUpperCase())?building:hasGeometry?(clean(row.STREET_NAME)||address):'';
    if(!name||name.length>100||!address||['NIL','NA','N/A'].includes(address.toUpperCase())||address.length>300)continue;
    const id=(await digest(name.toUpperCase()+'|'+address.toUpperCase())).slice(0,24);
    const geometry=hasGeometry?{latitude,longitude}:{};
    if(seen.has(id))continue;seen.add(id);results.push({id,name,address,postal,...geometry});
    if(results.length===20)break;
   }
   if(queries.size>=50)queries.delete(queries.keys().next().value);
   queries.set(key,{results,expires:Date.now()+300000});
   return results;
  }catch(error){
   if(error instanceof LocationError)throw error;
   // Never pass provider responses, credentials or network error details to clients.
   throw new LocationError('Location search is temporarily unavailable. Please try again.');
  }
 }
 const routes=new Map();
 async function authorized(url){
  let response;
  for(let attempt=0;attempt<2;attempt++){
   const value=await authenticate();response=await fetch(url,{headers:{Authorization:value},signal:AbortSignal.timeout(4000)});
   if(![401,403].includes(response.status))break;if(token?.value===value)token=null;
  }
  if(!response.ok)throw new LocationError('OneMap lookup is temporarily unavailable.');
  return response.json();
 }
 async function walk(start,end){
  const key=[start.latitude,start.longitude,end.latitude,end.longitude].join(',');
  const cached=routes.get(key);if(cached&&cached.expires>Date.now()){if(cached.error)throw new LocationError('No walking route available.');return cached.value}
  const url=new URL('https://www.onemap.gov.sg/api/public/routingsvc/route');
  url.search=new URLSearchParams({start:`${start.latitude},${start.longitude}`,end:`${end.latitude},${end.longitude}`,routeType:'walk'});
  try{
   const data=await authorized(url),seconds=Number(data.route_summary?.total_time);
   if(data.status!==0||!Number.isFinite(seconds)||seconds<0)throw new LocationError('No walking route found.');
   const value={minutes:Math.max(1,Math.ceil(seconds/60)),estimated:false};
   if(routes.size>=100)routes.delete(routes.keys().next().value);routes.set(key,{expires:Date.now()+3600000,value});return value;
  }catch(error){if(routes.size>=100)routes.delete(routes.keys().next().value);routes.set(key,{expires:Date.now()+300000,error:true});throw error}
 }
 async function planningArea(point){
  const url=new URL('https://www.onemap.gov.sg/api/public/popapi/getPlanningarea');
  url.search=new URLSearchParams({latitude:String(point.latitude),longitude:String(point.longitude),year:'2019'});
  const data=await authorized(url);return Array.isArray(data)&&typeof data[0]?.pln_area_n==='string'?data[0].pln_area_n:null;
 }
 const service={search,walk,planningArea};services.set(env,service);return service;
}
