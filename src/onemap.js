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
  if(!env.ONEMAP_EMAIL||!env.ONEMAP_PASSWORD)throw new LocationError('Location search is not connected yet. You can still enter your condo name.');
  if(token&&token.expires>Date.now()+60000)return token.value;
  if(!pending)pending=(async()=>{
   const response=await fetch('https://www.onemap.gov.sg/api/auth/post/getToken',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.ONEMAP_EMAIL,password:env.ONEMAP_PASSWORD}),signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new LocationError('Location search could not connect to OneMap. Please try again later.');
   const data=await response.json(),expires=Number(data.expiry_timestamp)*1000;
   if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(expires)||expires<=Date.now()+60000)throw new LocationError('Location search is temporarily unavailable.');
   token={value:data.access_token,expires};return token.value;
  })().finally(()=>{pending=null});
  return pending;
 }
 async function search(query){
  const q=clean(query);
  if(q.length<3||q.length>100)throw new LocationError('Enter 3–100 characters of a condo name or postal code.');
  const key=q.toLowerCase(),cached=queries.get(key);
  if(cached&&cached.expires>Date.now())return cached.results;
  try{
   const url=new URL('https://www.onemap.gov.sg/api/common/elastic/search');
   url.search=new URLSearchParams({searchVal:q,returnGeom:'Y',getAddrDetails:'Y',pageNum:'1'});
   let response;
   for(let attempt=0;attempt<2;attempt++){
    const value=await authenticate();
    response=await fetch(url,{headers:{Authorization:value},signal:AbortSignal.timeout(8000)});
    if(![401,403].includes(response.status))break;
    if(token?.value===value)token=null;
   }
   if(!response.ok)throw new LocationError(response.status===429?'OneMap is busy. Wait a moment and try again.':'Location search is temporarily unavailable.');
   const data=await response.json();
   if(!Array.isArray(data.results))throw new LocationError('Location search returned an unexpected response. Please try again.');
   const results=[],seen=new Set();
   for(const row of data.results.slice(0,50)){
    const name=clean(row.BUILDING),address=clean(row.ADDRESS),postal=/^\d{6}$/.test(row.POSTAL)?row.POSTAL:'';
    // Search covers all buildings, not just condos. Do not turn roads/NIL
    // entries into purported residential developments.
    if(!name||['NIL','NA','N/A'].includes(name.toUpperCase())||name.length>100||!address||address.length>300)continue;
    const id=(await digest(name.toUpperCase()+'|'+address.toUpperCase())).slice(0,24);
    const latitude=Number(row.LATITUDE),longitude=Number(row.LONGITUDE);
    const geometry=latitude>=1.1&&latitude<=1.5&&longitude>=103.5&&longitude<=104.5?{latitude,longitude}:{};
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
 const service={search};services.set(env,service);return service;
}
