import {test} from 'node:test';
import assert from 'node:assert/strict';
import {oneMap} from '../src/onemap.js';
const env=()=>({ONEMAP_EMAIL:'operator@example.test',ONEMAP_PASSWORD:'private-password'});
const token=()=>({access_token:'private-provider-token',expiry_timestamp:Math.floor(Date.now()/1000)+3600});
const row={BUILDING:'EXAMPLE GARDENS',ADDRESS:'1 EXAMPLE ROAD EXAMPLE GARDENS SINGAPORE 123456',POSTAL:'123456'};
test('OneMap keeps credentials on the server, shares token requests, caches and filters building results',async t=>{
 let auth=0,search=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('/getToken')){auth++;assert.deepEqual(JSON.parse(options.body),{email:'operator@example.test',password:'private-password'});return Response.json(token())}
  search++;assert.equal(options.headers.Authorization,'private-provider-token');assert.equal(new URL(url).searchParams.get('searchVal'),'example');
  return Response.json({results:[row,row,{BUILDING:'NIL',ADDRESS:'ROAD'},{}]});
 });
 const service=oneMap(env()),results=await Promise.all([service.search('example'),service.search('example')]);
 assert.equal(auth,1);assert.equal(results[0].length,1);assert.equal(results[0][0].postal,'123456');
 const previous=search;await service.search(' EXAMPLE ');assert.equal(search,previous);
 assert.ok(!JSON.stringify(results).includes('private-'));assert.equal(oneMap({}).search instanceof Function,true);
});
test('OneMap renews a rejected token once and reuses the replacement',async t=>{
 let auth=0,search=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/getToken')){auth++;return Response.json({...token(),access_token:'token-'+auth})}
  search++;return search===1?new Response('',{status:401}):Response.json({results:[row]});
 });
 const service=oneMap(env());assert.equal((await service.search('garden')).length,1);
 await service.search('another');assert.equal(auth,2);assert.equal(search,3);
});
test('OneMap renews before expiry and sanitizes upstream errors',async t=>{
 const context=env();let time=Date.now(),auth=0;
 t.mock.method(Date,'now',()=>time);
 const mock=t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/getToken')){auth++;return Response.json({access_token:'secret',expiry_timestamp:Math.floor(time/1000)+120})}
  return Response.json({results:[row]});
 });
 await oneMap(context).search('first');time+=70000;await oneMap(context).search('second');assert.equal(auth,2);
 mock.mock.mockImplementation(async()=>{throw Error('private-password')});
 await assert.rejects(oneMap(env()).search('third'),error=>!error.message.includes('private-password')&&error.message.includes('temporarily unavailable'));
 await assert.rejects(oneMap({}).search('third'),/not connected/);
 await assert.rejects(oneMap(context).search('xx'),/3–100/);
});
test('OneMap malformed responses and repeated authorization failures fail without an endless retry',async t=>{
 let requests=0;
 const mock=t.mock.method(globalThis,'fetch',async url=>{
  requests++;return String(url).includes('/getToken')?Response.json(token()):new Response('',{status:403});
 });
 await assert.rejects(oneMap(env()).search('garden'),/temporarily unavailable/);assert.equal(requests,4);
 mock.mock.mockImplementation(async url=>String(url).includes('/getToken')?Response.json(token()):Response.json({error:'unexpected'}));
 await assert.rejects(oneMap(env()).search('garden'),/unexpected response/);
});


test('OneMap accepts public places without a building name when coordinates are available',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('/getToken')?Response.json(token()):Response.json({results:[{BUILDING:'NIL',ADDRESS:'BISHAN PARK',STREET_NAME:'BISHAN PARK',LATITUDE:'1.36',LONGITUDE:'103.84',POSTAL:'NIL'}]}));
 const places=await oneMap(env()).search('bishan park');assert.equal(places.length,1);assert.equal(places[0].name,'BISHAN PARK');assert.equal(places[0].latitude,1.36);
});
