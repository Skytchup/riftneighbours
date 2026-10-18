import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {singaporeDate,singaporeDay,preferencesValid,validDate} from '../src/domain.js';
import {planningAreas} from '../src/areas.js';
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function fixture(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_game_deck_preferences.sql',import.meta.url),'utf8'));
 const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this},async first(){return sql.prepare(query).get(...this.args)||null},async all(){return {results:sql.prepare(query).all(...this.args)}},async run(){return sql.prepare(query).run(...this.args)}}},async batch(items){sql.exec('BEGIN');try{const results=[];for(const i of items)results.push(await i.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 sql.exec("INSERT INTO areas VALUES ('a','Test estate','East'),('b','Other estate','East'),('c','Distant estate','West')");
 for(const [id,area] of [['me','a'],['other','a'],['third','b'],['far','c']]){sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,id,id+'-secret-name',area,'casual',1,0);sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest(id),id,Math.floor(Date.now()/1000)+3600)}
 const env={DB,APP_ORIGIN:'https://example.test',GOOGLE_CLIENT_ID:'configured',GOOGLE_CLIENT_SECRET:'configured',ASSETS:{fetch:()=>new Response('asset')}};
 async function call(path,method='GET',body,user='me',origin='https://example.test'){const headers={Cookie:'rn_session='+user};if(method!=='GET')headers.Origin=origin;const res=await worker.fetch(new Request('https://example.test/api/'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);return {status:res.status,data:await res.json()}}
 return {sql,call,env};}
test('Singapore date rolls over independently of UTC',()=>{assert.equal(singaporeDate(new Date('2026-10-16T16:01:00Z')),'2026-10-17');assert.equal(singaporeDay('2026-10-17'),6);assert.equal(validDate('2026-02-30'),false);assert.equal(preferencesValid([{day:7,slot:'evening'}]),false);assert.equal(preferencesValid([{day:1,slot:'evening'},{day:1,slot:'evening'}]),false)});
test('authentication and cross-origin writes fail closed',async()=>{const {call}=await fixture();assert.equal((await call('me','GET',null,'invalid')).status,401);assert.equal((await call('tonight','PUT',{slot:'evening',available:true},'me','https://evil.test')).status,403)});

test('Google login reports missing setup and validates callback state before contacting Google',async()=>{
 const {env}=await fixture();
 const request=(path,headers={})=>worker.fetch(new Request('https://example.test'+path,{headers}),env);
 assert.deepEqual(await (await request('/api/status')).json(),{loginAvailable:false});
 assert.equal((await request('/auth/google')).headers.get('location'),'/?signin=setup');
 env.PILOT_GOOGLE_SUBS='invited';
 const start=await request('/auth/google');
 const destination=new URL(start.headers.get('location'));
 assert.equal(destination.origin,'https://accounts.google.com');
 assert.equal(destination.searchParams.get('redirect_uri'),'https://example.test/auth/callback');
 assert.equal(destination.searchParams.get('scope'),'openid email');
 assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
 assert.equal((await request('/auth/callback?state=wrong&code=test',{Cookie:'oauth_state=expected'})).headers.get('location'),'/?signin=expired');
 assert.equal((await request('/auth/callback?state=expected&error=access_denied',{Cookie:'oauth_state=expected'})).headers.get('location'),'/?signin=cancelled');
});

test('Google login persists one account, restores its profile, and issues revocable hashed sessions',async t=>{
 const {sql,env}=await fixture();env.PILOT_GOOGLE_SUBS='invited';
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/token')?{access_token:'google-token'}:{sub:'invited'}));
 const signIn=()=>worker.fetch(new Request('https://example.test/auth/callback?state=expected&code=test',{headers:{Cookie:'oauth_state=expected'}}),env);
 const first=await signIn();assert.equal(first.headers.get('location'),'https://example.test/?welcome=1#profile');
 const sessionCookie=first.headers.getSetCookie().find(x=>x.startsWith('rn_session=')).split(';')[0];
 const rawToken=sessionCookie.slice('rn_session='.length);
 assert.equal(sql.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').get(rawToken).n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM sessions WHERE token_hash=?').get(await digest(rawToken)).n,1);
 const call=(path,method='GET',body)=>worker.fetch(new Request('https://example.test/api/'+path,{method,headers:{Cookie:sessionCookie,Origin:env.APP_ORIGIN},body:body?JSON.stringify(body):undefined}),env);
 assert.equal((await call('profile','PUT',{username:'Neighbour',area_id:'b',style:'learning',share_condo:true})).status,200);
 const second=await signIn();assert.equal(second.headers.get('location'),'https://example.test/#nearby');
 assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE google_sub=?').get('invited').n,1);
 const restored=await (await call('me')).json();assert.equal(restored.user.username,'Neighbour');assert.equal(restored.user.area_id,'b');
 assert.equal(restored.user.google_sub,undefined);
 await call('logout','POST');assert.equal((await call('me')).status,401);
});

test('Google identities outside the pilot and failed token exchanges never create accounts',async t=>{
 const {sql,env}=await fixture();env.PILOT_GOOGLE_SUBS='invited';
 const mock=t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/token')?{access_token:'google-token'}:{sub:'uninvited'}));
 const signIn=()=>worker.fetch(new Request('https://example.test/auth/callback?state=expected&code=test',{headers:{Cookie:'oauth_state=expected'}}),env);
 assert.equal((await signIn()).headers.get('location'),'/?signin=invite');
 assert.equal(sql.prepare('SELECT count(*) n FROM users').get().n,4);
 mock.mock.mockImplementation(async()=>Response.json({error:'invalid_grant'},{status:400}));
 assert.equal((await signIn()).headers.get('location'),'/?signin=failed');
 assert.equal(sql.prepare('SELECT count(*) n FROM sessions').get().n,4);
});

test('email invitations require a Google-verified exact email and keep accounts keyed by subject',async t=>{
 const {sql,env}=await fixture();env.PILOT_EMAILS=' invited@example.test ';
 let identity={sub:'email-invited',email:'Invited@Example.Test',email_verified:true};
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/token')?{access_token:'google-token'}:identity));
 const signIn=()=>worker.fetch(new Request('https://example.test/auth/callback?state=expected&code=test',{headers:{Cookie:'oauth_state=expected'}}),env);
 const status=await worker.fetch(new Request('https://example.test/api/status'),env);
 assert.equal((await status.json()).loginAvailable,true);
 for(const denied of [
  {sub:'denied',email:'invited@example.test',email_verified:false},
  {sub:'denied',email:'invited@example.test',email_verified:'true'},
  {sub:'denied',email:'someone@example.test',email_verified:true},
  {sub:'denied',email:'invited@example.test.evil.test',email_verified:true},
  {sub:'denied',email_verified:true}
 ]){identity=denied;assert.equal((await signIn()).headers.get('location'),'/?signin=invite')}
 assert.equal(sql.prepare('SELECT count(*) n FROM users').get().n,4);
 identity={sub:'email-invited',email:'Invited@Example.Test',email_verified:true};
 assert.equal((await signIn()).headers.get('location'),'https://example.test/?welcome=1#profile');
 await signIn();assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE google_sub=?').get('email-invited').n,1);
});
test('confirmation is explicit, expires by Singapore date, and counts protect small groups',async()=>{const {sql,call}=await fixture();const date=singaporeDate();sql.prepare('INSERT INTO confirmations VALUES(?,?,?)').run('other',date,'evening');sql.prepare('INSERT INTO confirmations VALUES(?,?,?)').run('third','2020-01-01','evening');let r=await call('nearby');assert.equal(r.data.counts.find(x=>x.slot==='evening').confirmed,'1–2');assert.ok(!JSON.stringify(r.data).includes('secret-name'));await call('tonight','PUT',{slot:'evening',available:true});assert.equal((await call('me')).data.confirmations.length,1);assert.equal((await call('nearby')).data.counts.find(x=>x.slot==='evening').confirmed,'1–2');await call('tonight','PUT',{slot:'evening',available:false});assert.equal((await call('me')).data.confirmations.length,0)});
test('preferences are atomic and invalid duplicates rejected',async()=>{const {call}=await fixture();assert.equal((await call('preferences','PUT',{preferences:[{day:2,slot:'late'}]})).status,200);assert.equal((await call('preferences','PUT',{preferences:[{day:1,slot:'late'},{day:1,slot:'late'}]})).status,400);assert.deepEqual((await call('me')).data.preferences,[{day:2,slot:'late'}])});

test('empty catalogues offer all 55 planning areas and neighbourhood-only profiles save without condo sharing',async()=>{
 const {sql,call}=await fixture();sql.exec('DELETE FROM areas');
 const choices=(await call('me')).data.areas;
 assert.equal(choices.length,55);assert.equal(new Set(choices.map(a=>a.id)).size,55);
 assert.equal(planningAreas.length,55);
 const body={username:'Alex',style:'casual',area_id:'sg-pa-bedok',share_condo:true};
 assert.equal((await call('profile','PUT',body)).status,200);
 const restored=(await call('me')).data;
 assert.equal(restored.user.area_id,'sg-pa-bedok');assert.equal(restored.user.share_condo,0);
 assert.equal(restored.areas.filter(a=>a.id==='sg-pa-bedok').length,1);
 assert.equal((await call('nearby')).status,200);
 assert.equal((await call('nearby?scope=condo')).status,403);
 assert.equal((await call('profile','PUT',{...body,area_id:'sg-pa-fake'})).status,400);
});

test('self-declared condos persist, normalize within a planning area and support neighbourhood discovery',async()=>{
 const {sql,call}=await fixture();
 const body={username:'Alex',style:'learning',area_id:'sg-pa-bedok',condo_name:' Example   Gardens ',share_condo:true};
 const saved=await call('profile','PUT',body);assert.equal(saved.status,200);
 assert.equal(saved.data.area.name,'Example Gardens');assert.equal(saved.data.area.neighbourhood,'Bedok');
 const id=saved.data.area.id;
 assert.equal((await call('profile','PUT',{...body,condo_name:'EXAMPLE GARDENS'},'other')).data.area.id,id);
 assert.equal(sql.prepare('SELECT count(*) n FROM areas WHERE id=?').get(id).n,1);
 const restored=(await call('me')).data;
 assert.equal(restored.user.area_id,id);assert.equal(restored.user.share_condo,1);
 assert.ok(restored.areas.some(a=>a.id===id&&a.kind==='condo'));
 await call('tonight','PUT',{slot:'evening',available:true},'other');
 assert.equal((await call('nearby')).data.counts.find(c=>c.slot==='evening').confirmed,'1–2');
 assert.equal((await call('nearby?scope=condo')).data.counts.find(c=>c.slot==='evening').confirmed,'1–2');
 assert.notEqual((await call('profile','PUT',{...body,area_id:'sg-pa-tampines'},'third')).data.area.id,id);
 const invalid=await call('profile','PUT',{...body,condo_name:'x'.repeat(101)});assert.equal(invalid.status,400);
 assert.equal((await call('me')).data.user.area_id,id);
});

test('OneMap search requires a session and saves only a server-validated building selection',async t=>{
 const {env,call}=await fixture();env.ONEMAP_EMAIL='operator@example.test';env.ONEMAP_PASSWORD='private';
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{
  calls++;
  return Response.json(String(url).includes('/getToken')?{access_token:'private-token',expiry_timestamp:Math.floor(Date.now()/1000)+3600}:{results:[{BUILDING:'EXAMPLE GARDENS',ADDRESS:'1 EXAMPLE ROAD',POSTAL:'123456'}]});
 });
 assert.equal((await call('locations?q=garden','GET',null,'invalid')).status,401);assert.equal(calls,0);
 assert.equal((await call('locations?q=ab')).status,400);
 const found=await call('locations?q=garden');assert.equal(found.status,200);assert.equal(found.data.results.length,1);
 assert.ok(!JSON.stringify(found.data).includes('private'));
 const selected=found.data.results[0];
 const body={username:'Alex',area_id:'sg-pa-bedok',style:'casual',share_condo:true,condo_name:'Forged client name',onemap_selection:{query:'garden',id:selected.id}};
 const saved=await call('profile','PUT',body);assert.equal(saved.status,200);assert.equal(saved.data.area.name,'EXAMPLE GARDENS');
 assert.equal((await call('me')).data.user.area_id,saved.data.area.id);
 assert.equal((await call('profile','PUT',{...body,onemap_selection:{query:'garden',id:'forged'}})).status,400);
 assert.equal((await call('me')).data.user.area_id,saved.data.area.id);
});
test('game starts without a venue; only accepted participants read messages and exact instructions',async()=>{const {call}=await fixture();const created=await call('games','POST',{title:'Relaxed games',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'own',extra_decks:true});assert.equal(created.status,201);const id=created.data.id;await call('games/'+id+'/venue','PUT',{details:'Private meeting point'});await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other');assert.equal((await call('games/'+id+'/messages','GET',null,'other')).status,403);const pending=await call('games/'+id+'/requests');await call('games/'+id+'/requests','PUT',{id:pending.data.requests[0].id,status:'accepted'});assert.equal((await call('games/'+id+'/messages','GET',null,'other')).data.details,'Private meeting point');const publicGames=JSON.stringify((await call('games','GET',null,'third')).data);assert.ok(!publicGames.includes('Private meeting point'));assert.ok(!publicGames.includes('secret-name'));assert.equal((await call('games/'+id+'/messages','POST',{body:'Hello'},'third')).status,403);assert.equal((await call('games/'+id+'/requests','PUT',{id:pending.data.requests[0].id,status:'accepted'},'third')).status,403);assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'far')).status,400)});
test('blocking prevents game access and account deletion cascades',async()=>{const {sql,call}=await fixture();const id=(await call('games','POST',{title:'Hi',date:singaporeDate(),slot:'late',venue:'decide',deck_need:'own',extra_decks:true})).data.id;await call('blocks','POST',{user_id:'other'});assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other')).status,404);await call('account','DELETE');assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE id=?').get('me').n,0);assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,0);assert.equal((await call('me')).status,401)});

test('deck needs are game-specific and cannot contradict extra-deck offers',async()=>{const {call}=await fixture();const data={title:'Borrow a deck',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'need',extra_decks:false};assert.equal((await call('games','POST',{...data,extra_decks:true})).status,400);const id=(await call('games','POST',data)).data.id;assert.equal((await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:true},'other')).status,200);const request=(await call('games/'+id+'/requests')).data.requests[0];assert.equal(request.deck_need,'own');assert.equal(request.extra_decks,1);await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other');const updated=(await call('games/'+id+'/requests')).data.requests[0];assert.equal(updated.status,'accepted');assert.equal(updated.deck_need,'need');assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:true},'third')).status,400)});
