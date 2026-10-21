import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {singaporeDate,singaporeDay,singaporeSlot,preferencesValid,validDate} from '../src/domain.js';
import {planningAreas} from '../src/areas.js';
import {legends} from '../public/legends.js';
import {locateArea} from '../src/discovery.js';
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function fixture({legacy=false}={}){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));if(!legacy)sql.exec(readFileSync(new URL('../migrations/0002_game_deck_preferences.sql',import.meta.url),'utf8'));
 const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this},async first(){return sql.prepare(query).get(...this.args)||null},async all(){return {results:sql.prepare(query).all(...this.args)}},async run(){return sql.prepare(query).run(...this.args)}}},async batch(items){sql.exec('BEGIN');try{const results=[];for(const i of items)results.push(await i.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 sql.exec("INSERT INTO areas VALUES ('a','Test estate','East'),('b','Other estate','East'),('c','Distant estate','West')");
 for(const [id,area] of [['me','a'],['other','a'],['third','b'],['far','c']]){sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,id,id+'-secret-name',area,'casual',1,0);sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest(id),id,Math.floor(Date.now()/1000)+3600)}
 const env={DB,APP_ORIGIN:'https://example.test',GOOGLE_CLIENT_ID:'configured',GOOGLE_CLIENT_SECRET:'configured',ASSETS:{fetch:()=>new Response('asset')}};
 async function call(path,method='GET',body,user='me',origin='https://example.test'){const headers={Cookie:'rn_session='+user};if(method!=='GET')headers.Origin=origin;const res=await worker.fetch(new Request('https://example.test/api/'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);return {status:res.status,data:await res.json()}}
 return {sql,call,env};}
test('Singapore date rolls over independently of UTC',()=>{assert.equal(singaporeDate(new Date('2026-10-16T16:01:00Z')),'2026-10-17');assert.equal(singaporeDay('2026-10-17'),6);assert.equal(validDate('2026-02-30'),false);assert.equal(preferencesValid([{day:7,slot:'evening'}]),false);assert.equal(preferencesValid([{day:1,slot:'evening'},{day:1,slot:'evening'}]),false)});
test('authentication and cross-origin writes fail closed',async()=>{const {call}=await fixture();assert.equal((await call('me','GET',null,'invalid')).status,401);assert.equal((await call('tonight','PUT',{slot:'evening',available:true},'me','https://evil.test')).status,403)});

test('My Places persist privately and allow removing the profile place',async()=>{
 const {call,sql}=await fixture();
 let overview=await call('condos');assert.equal(overview.status,200);assert.equal(overview.data.favourites[0].id,'a');assert.equal(overview.data.favourites[0].is_home,true);
 assert.equal((await call('condos/favourites','PUT',{area_id:'b'})).status,200);
 assert.equal((await call('condos/favourites','PUT',{area_id:'b'})).status,200);
 assert.equal((await call('condos')).data.favourites.length,2);
 assert.equal((await call('condos','GET',null,'other')).data.favourites.length,1);
 await call('condos/favourites','DELETE',{area_id:'a'});assert.equal((await call('condos')).data.favourites[0].id,'b');
 await call('condos/favourites','DELETE',{area_id:'b'});assert.equal((await call('condos')).data.favourites.length,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM condo_favourites WHERE user_id=\'me\'').get().n,0);
 assert.equal((await call('condos/favourites','PUT',{area_id:'unknown'})).status,400);
 assert.equal((await call('condos','GET',null,'invalid')).status,401);
});

test('condo week grids return only anonymous default totals across all 35 slots',async()=>{
 const {call,sql}=await fixture();await call('me');
 const stamp=Math.floor(Date.now()/1000);
 for(const uid of ['me','other'])sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run(uid,3,'evening',stamp);
 sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run('other',5,'late',0);
 let response=await call('condos/a/schedule');assert.equal(response.status,200);assert.equal(response.data.cells.length,35);
 assert.equal(response.data.cells.find(c=>c.day===3&&c.slot==='evening').count,2);
 assert.equal(response.data.cells.find(c=>c.day===5&&c.slot==='late').count,0);
 assert.ok(!JSON.stringify(response.data).includes('secret-name'));assert.ok(!('players' in response.data));
 sql.prepare('UPDATE users SET share_condo=0,share_map=1 WHERE id=?').run('other');
 assert.equal((await call('condos/a/schedule')).data.cells.find(c=>c.day===3&&c.slot==='evening').count,2);
 sql.prepare('UPDATE users SET share_condo=1 WHERE id=?').run('other');await call('blocks','POST',{user_id:'other'});
 assert.equal((await call('condos/a/schedule')).data.cells.find(c=>c.day===3&&c.slot==='evening').count,1);
 assert.equal((await call('condos/not-found/schedule')).status,404);
});

test('OneMap condo search can open a new condo and favourite it without changing the home profile',async t=>{
 const {env,call}=await fixture();env.ONEMAP_EMAIL='operator@example.test';env.ONEMAP_PASSWORD='private';
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/getToken'))return Response.json({access_token:'token',expiry_timestamp:Math.floor(Date.now()/1000)+3600});
  if(String(url).includes('getPlanningarea'))return Response.json([{pln_area_n:'BEDOK'}]);
  return Response.json({results:[{BUILDING:'NEW GARDENS',ADDRESS:'1 New Road',POSTAL:'123456',LATITUDE:'1.35',LONGITUDE:'103.87'}]});
 });
 const search=await call('condos/search?q=new');assert.equal(search.status,200);
 const result=search.data.results.find(a=>a.name==='NEW GARDENS');assert.equal(result.saved,false);
 const selected=await call('condos/select','POST',{query:'new',id:result.id});assert.equal(selected.status,200);assert.equal(selected.data.area.neighbourhood,'Bedok');
 assert.equal((await call('me')).data.user.area_id,'a');
 assert.equal((await call('condos/'+selected.data.area.id+'/schedule')).data.cells.every(c=>c.count===0),true);
 await call('condos/favourites','PUT',{area_id:selected.data.area.id});assert.ok((await call('condos')).data.favourites.some(a=>a.id===selected.data.area.id));
 const repeated=await call('condos/select','POST',{query:'new',id:result.id});assert.equal(repeated.data.area.id,selected.data.area.id);
 assert.equal((await call('condos/select','POST',{query:'new',id:'fake'})).status,503);
});

test('nearby condos load from saved data, rank ready players first and label walking estimates',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T10:30:00Z')});
 const {env,call,sql}=await fixture();await call('me');env.ONEMAP_EMAIL='operator@example.test';env.ONEMAP_PASSWORD='private';
 for(const [id,lat] of [['a',1.35],['b',1.351],['c',1.352]])sql.prepare('UPDATE areas SET latitude=?,longitude=? WHERE id=?').run(lat,103.87,id);
 sql.prepare('UPDATE users SET area_id=? WHERE id=?').run('b','other');
 sql.prepare('UPDATE users SET area_id=? WHERE id=?').run('c','third');
 sql.prepare('UPDATE users SET area_id=? WHERE id=?').run('c','far');
 for(const uid of ['other','third','far'])sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run(uid,1,'evening',Math.floor(Date.now()/1000));
 sql.prepare('UPDATE users SET available_until=? WHERE id=?').run(Math.floor(Date.now()/1000)+3600,'other');
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/getToken'))return Response.json({access_token:'token',expiry_timestamp:Math.floor(Date.now()/1000)+3600});
  const u=new URL(url);assert.equal(u.searchParams.get('routeType'),'walk');
  return Response.json({status:0,route_summary:{total_time:u.searchParams.get('end').startsWith('1.351,')?840:600}});
 });
 let response=await call('condos');assert.equal(response.status,200);assert.deepEqual(response.data.nearby.map(a=>a.id),['b','c']);assert.ok(response.data.nearby[0].walk.minutes<=15);assert.equal(response.data.nearby[0].walk.estimated,true);
 sql.prepare('UPDATE users SET available_until=0').run();response=await call('condos');assert.deepEqual(response.data.nearby.map(a=>a.id),['c','b']);
 assert.ok(!JSON.stringify(response.data).includes('secret-name'));
});

test('browsing discovery and condos does not depend on OneMap or external network availability',async t=>{
 const {call,sql}=await fixture();await call('me');
 sql.prepare('UPDATE areas SET latitude=1.35,longitude=103.87 WHERE id=?').run('a');
 sql.prepare('UPDATE areas SET latitude=1.351,longitude=103.87 WHERE id=?').run('b');
 sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run('third',1,'evening',Math.floor(Date.now()/1000));
 const mocked=t.mock.method(globalThis,'fetch',async()=>{throw Error('Provider should not be called by browsing')});
 const result=await call('condos');assert.equal(result.status,200);assert.equal(result.data.nearby[0].walk.estimated,true);
 assert.equal((await call('discovery')).status,200);
 sql.prepare('UPDATE areas SET latitude=NULL,longitude=NULL WHERE id=?').run('a');
 assert.equal((await call('discovery')).status,200);assert.equal((await call('condos')).status,200);
 assert.equal(mocked.mock.callCount(),0);
});

test('Available Now expires after two hours, can be stopped, and does not implicitly share map identity',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T10:30:00Z')});
 const {call,sql}=await fixture();await call('me');
 let result=await call('presence','PUT',{available:true});assert.equal(result.status,200);assert.equal(result.data.available_until,Math.floor(Date.now()/1000)+7200);assert.equal(result.data.share_map,0);
 await call('presence','PUT',{available:false});assert.equal((await call('me')).data.user.available_until,0);
 const active=await call('presence','PUT',{available:true});
 t.mock.timers.tick(7200001);sql.prepare('UPDATE sessions SET expires_at=?').run(Math.floor(Date.now()/1000)+3600);
 assert.ok((await call('me')).data.user.available_until<=Date.now()/1000);
 assert.equal((await call('presence','PUT',{share_map:true})).data.available_until,active.data.available_until);
 await call('profile','PUT',{username:'Alex',area_id:'sg-pa-bedok',style:'casual',share_condo:false});
 assert.equal((await call('presence','PUT',{share_map:true})).status,400);
});

test('map discovery uses current SGT schedule, anonymous defaults, exact coordinates, radius and blocking',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T10:30:00Z')});
 assert.equal(singaporeSlot(),'evening');
 const {call,sql}=await fixture();await call('me');
 sql.prepare('UPDATE areas SET latitude=?,longitude=?,address=? WHERE id=?').run(1.35,103.87,'1 Example Road','a');
 sql.prepare('UPDATE areas SET latitude=?,longitude=?,address=? WHERE id=?').run(1.36,103.88,'2 Example Road','b');
 sql.prepare('UPDATE areas SET latitude=?,longitude=? WHERE id=?').run(1.45,103.75,'c');
 sql.prepare('UPDATE users SET available_until=?').run(Math.floor(Date.now()/1000)+7200);
 assert.equal((await call('discovery')).data.groups.length,2); // anonymous presence is included by default
 sql.prepare('UPDATE users SET share_map=1,available_until=0').run();
 sql.prepare('UPDATE users SET available_until=? WHERE id=?').run(Math.floor(Date.now()/1000)+7200,'other');
 for(const uid of ['other','third','far'])sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run(uid,singaporeDay(singaporeDate()),'evening',Math.floor(Date.now()/1000));
 let found=await call('discovery');assert.equal(found.status,200);assert.equal(found.data.groups.length,2);
 for(const radius of [0.5,1,2,5]){const result=await call('discovery?radius='+radius);assert.equal(result.status,200);assert.equal(result.data.groups.length,radius<2?1:2)}
 assert.equal((await call('discovery?radius=20')).status,400);assert.equal((await call('discovery?radius=10')).status,400);
 assert.equal(found.data.groups.reduce((n,g)=>n+g.ready_count,0),1);assert.equal(found.data.groups.reduce((n,g)=>n+g.usual_count,0),2);assert.ok(!JSON.stringify(found.data).includes('secret-name'));assert.ok(found.data.groups.every(g=>!('players' in g)));
 assert.equal(found.data.groups.reduce((n,g)=>n+g.total_count,0),2); // self and distant player excluded
 assert.equal((await call('discovery?scope=condo')).data.groups.length,1);
 assert.equal((await call('discovery?radius=0')).status,400);
 await call('blocks','POST',{user_id:'other'});assert.equal((await call('discovery')).data.groups.reduce((n,g)=>n+g.total_count,0),1);
 sql.prepare('UPDATE areas SET latitude=NULL,longitude=NULL WHERE id=?').run('b');
 const unmapped=await call('discovery');assert.equal(unmapped.data.groups.length,0);assert.equal(unmapped.data.unmapped,1);
 sql.prepare('UPDATE preferences SET updated_at=0').run();assert.equal((await call('discovery')).data.groups.length,0);
 assert.equal(singaporeSlot(new Date('2026-10-19T05:59:00Z')),'lunch');
 assert.equal(singaporeSlot(new Date('2026-10-19T06:00:00Z')),'afternoon');
 assert.equal(singaporeSlot(new Date('2026-10-19T13:00:00Z')),'late');
});

test('existing condos receive exact-name OneMap coordinates without changing their saved identity',async t=>{
 const {env,call,sql}=await fixture();await call('me');env.ONEMAP_EMAIL='operator@example.test';env.ONEMAP_PASSWORD='private';
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/getToken')?{access_token:'token',expiry_timestamp:Math.floor(Date.now()/1000)+3600}:{results:[
  {BUILDING:'TEST ESTATE CLUBHOUSE',ADDRESS:'Wrong result',LATITUDE:'1.4',LONGITUDE:'103.9'},
  {BUILDING:'TEST ESTATE',ADDRESS:'1 Test Road',POSTAL:'123456',LATITUDE:'1.35',LONGITUDE:'103.87'}
 ]}));
 const located=await locateArea(env,'a');assert.equal(located.id,'a');assert.equal(located.latitude,1.35);
 assert.equal(sql.prepare('SELECT address FROM areas WHERE id=?').get('a').address,'1 Test Road');
 assert.equal((await call('me')).data.user.area_id,'a');
});

test('manual initial schema upgrades safely and profile save opens Nearby without missing game columns',async()=>{
 const {call,sql}=await fixture({legacy:true});
 sql.prepare('INSERT INTO decks(id,user_id,name,lend) VALUES(?,?,?,?)').run('old-deck','me','Annie',0);
 const profile=await call('profile','PUT',{username:'Alex',area_id:'sg-pa-bedok',style:'casual',share_condo:false});
 assert.equal(profile.status,200);
 assert.equal((await call('nearby')).status,200);assert.equal((await call('games')).status,200);
 assert.equal((await call('my-games')).status,200);
 assert.equal((await call('me')).data.decks[0].name,'Annie');
 const game=await call('games','POST',{title:'A game',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'own',extra_decks:false});assert.equal(game.status,201);
 const cols=sql.prepare('PRAGMA table_info(games)').all().map(c=>c.name);assert.ok(cols.includes('deck_need'));assert.ok(cols.includes('extra_decks'));
});

test('profile and Legend decks save together; default and custom names persist without data loss',async()=>{
 const {call,sql}=await fixture();const annie=legends.find(l=>l.champion==='Annie');
 const body={username:'Alex',area_id:'sg-pa-bedok',style:'learning',share_condo:false,decks:[{legend_id:annie.id,custom_name:''}]};
 assert.equal((await call('profile','PUT',body)).status,200);
 let deck=(await call('me')).data.decks[0];assert.equal(deck.legend_id,annie.id);assert.equal(deck.name,`${annie.champion} · ${annie.title}`);assert.equal(deck.custom_name,'');
 assert.equal((await call('profile','PUT',{...body,decks:[{legend_id:annie.id,custom_name:' My fiery deck '}]})).status,200);
 deck=(await call('me')).data.decks[0];assert.equal(deck.name,'My fiery deck');assert.equal(deck.custom_name,'My fiery deck');
 assert.equal((await call('profile','PUT',{...body,username:'Must not save',decks:[{legend_id:'unknown',custom_name:''}]})).status,400);
 assert.equal((await call('me')).data.user.username,'Alex');assert.equal((await call('me')).data.decks[0].name,'My fiery deck');
 // Force a failure after profile statements; D1's transaction must roll back all changes.
 sql.exec("CREATE TRIGGER reject_deck BEFORE INSERT ON decks BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 assert.equal((await call('profile','PUT',{...body,username:'Rolled back'})).status,500);
 assert.equal((await call('me')).data.user.username,'Alex');assert.equal((await call('me')).data.decks[0].name,'My fiery deck');
});

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
 const second=await signIn();assert.equal(second.headers.get('location'),'https://example.test/#home');
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

test('manual condo names cannot create or rename developments',async()=>{
 const {sql,call}=await fixture();const before=sql.prepare('SELECT count(*) n FROM areas').get().n;
 const response=await call('profile','PUT',{username:'Alex',style:'casual',area_id:'sg-pa-bedok',condo_name:'Fake New Condo',share_condo:true});
 assert.equal(response.status,400);assert.equal(sql.prepare('SELECT count(*) n FROM areas').get().n,before);assert.equal((await call('me')).data.user.area_id,'a');
});

test('OneMap search requires a session and saves only a server-validated building selection',async t=>{
 const {env,call}=await fixture();env.ONEMAP_EMAIL='operator@example.test';env.ONEMAP_PASSWORD='private';
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{
  calls++;
  return Response.json(String(url).includes('/getToken')?{access_token:'private-token',expiry_timestamp:Math.floor(Date.now()/1000)+3600}:{results:[{BUILDING:'EXAMPLE GARDENS',ADDRESS:'1 EXAMPLE ROAD',POSTAL:'123456',LATITUDE:'1.35',LONGITUDE:'103.87'}]});
 });
 assert.equal((await call('locations?q=garden','GET',null,'invalid')).status,401);assert.equal(calls,0);
 assert.equal((await call('locations?q=ab')).status,400);
 const found=await call('locations?q=garden');assert.equal(found.status,200);assert.equal(found.data.results.length,1);
 assert.ok(!JSON.stringify(found.data).includes('private'));
 const selected=found.data.results[0];
 const body={username:'Alex',area_id:'sg-pa-bedok',style:'casual',share_condo:true,condo_name:'Forged client name',onemap_selection:{query:'garden',id:selected.id}};
 const saved=await call('profile','PUT',body);assert.equal(saved.status,200);assert.equal(saved.data.area.name,'EXAMPLE GARDENS');
 const restoredArea=(await call('me')).data.areas.find(a=>a.id===saved.data.area.id);assert.equal(restoredArea.latitude,1.35);assert.equal(restoredArea.longitude,103.87);assert.equal(restoredArea.address,'1 EXAMPLE ROAD');
 assert.equal((await call('me')).data.user.area_id,saved.data.area.id);
 assert.equal((await call('profile','PUT',{...body,onemap_selection:{query:'garden',id:'forged'}})).status,400);
 assert.equal((await call('me')).data.user.area_id,saved.data.area.id);
});
test('game starts without a venue; only accepted participants read messages and exact instructions',async()=>{const {call}=await fixture();const created=await call('games','POST',{title:'Relaxed games',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'own',extra_decks:true});assert.equal(created.status,201);const id=created.data.id;await call('games/'+id+'/venue','PUT',{details:'Private meeting point'});await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other');assert.equal((await call('games/'+id+'/messages','GET',null,'other')).status,403);const pending=await call('games/'+id+'/requests');await call('games/'+id+'/requests','PUT',{id:pending.data.requests[0].id,status:'accepted'});assert.equal((await call('games/'+id+'/messages','GET',null,'other')).data.details,'Private meeting point');const publicGames=JSON.stringify((await call('games','GET',null,'third')).data);assert.ok(!publicGames.includes('Private meeting point'));assert.ok(!publicGames.includes('secret-name'));assert.equal((await call('games/'+id+'/messages','POST',{body:'Hello'},'third')).status,403);assert.equal((await call('games/'+id+'/requests','PUT',{id:pending.data.requests[0].id,status:'accepted'},'third')).status,403);assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'far')).status,400)});
test('blocking prevents game access and account deletion cascades',async()=>{const {sql,call}=await fixture();const id=(await call('games','POST',{title:'Hi',date:singaporeDate(),slot:'late',venue:'decide',deck_need:'own',extra_decks:true})).data.id;await call('blocks','POST',{user_id:'other'});assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other')).status,404);await call('account','DELETE');assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE id=?').get('me').n,0);assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,0);assert.equal((await call('me')).status,401)});

test('deck needs are game-specific and cannot contradict extra-deck offers',async()=>{const {call}=await fixture();const data={title:'Borrow a deck',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'need',extra_decks:false};assert.equal((await call('games','POST',{...data,extra_decks:true})).status,400);const id=(await call('games','POST',data)).data.id;assert.equal((await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:true},'other')).status,200);const request=(await call('games/'+id+'/requests')).data.requests[0];assert.equal(request.deck_need,'own');assert.equal(request.extra_decks,1);await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:false},'other');const updated=(await call('games/'+id+'/requests')).data.requests[0];assert.equal(updated.status,'accepted');assert.equal(updated.deck_need,'need');assert.equal((await call('games/'+id+'/join','POST',{deck_need:'need',extra_decks:true},'third')).status,400)});

test('public registration requires an explicit flag and a Google-verified email',async t=>{
 const {env,sql}=await fixture();let identity={sub:'public-user',email:'new@example.test',email_verified:true};
 t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/token')?{access_token:'google-token'}:identity));
 const signIn=()=>worker.fetch(new Request('https://example.test/auth/callback?state=expected&code=test',{headers:{Cookie:'oauth_state=expected'}}),env);
 env.PUBLIC_SIGNUP='false';env.PILOT_EMAILS='invited@example.test';
 assert.equal((await signIn()).headers.get('location'),'/?signin=invite');
 env.PUBLIC_SIGNUP='true';delete env.PILOT_EMAILS;
 assert.equal((await signIn()).headers.get('location'),'https://example.test/?welcome=1#profile');
 assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE google_sub=?').get('public-user').n,1);
 for(const invalid of [false,'true',undefined]){identity={sub:'unverified-user',email:'new@example.test',email_verified:invalid};assert.equal((await signIn()).headers.get('location'),'/?signin=invite')}
 assert.equal(sql.prepare('SELECT count(*) n FROM users WHERE google_sub=?').get('unverified-user').n,0);
});

test('public registration never allows anonymous community reads or writes',async()=>{
 const {env,call}=await fixture();env.PUBLIC_SIGNUP='true';
 for(const path of ['discovery','condos','condos/a/schedule','condos/search?q=test','locations?q=test','me','games','my-games','nearby']){
  assert.equal((await call(path,'GET',null,'invalid')).status,401,path);
 }
 assert.equal((await call('presence','PUT',{available:true},'invalid')).status,401);
});


test('game cards track requests, accepted players and full status server-side',async()=>{
 const {call}=await fixture();const id=(await call('games','POST',{title:'Testing membership',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 let card=(await call('games','GET',null,'other')).data.games[0];assert.equal(card.participant_count,1);assert.equal(card.request_status,null);
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other');
 card=(await call('games','GET',null,'other')).data.games[0];assert.equal(card.request_status,'pending');assert.equal(card.participant_count,1);
 assert.equal((await call('notifications')).data.unread,1);
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other');assert.equal((await call('notifications')).data.unread,1);
 const request=(await call('games/'+id+'/requests')).data.requests[0];await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});
 card=(await call('games','GET',null,'other')).data.games[0];assert.equal(card.request_status,'accepted');assert.equal(card.participant_count,2);
 assert.equal((await call('notifications','GET',null,'other')).data.notifications[0].kind,'request_update');
 assert.equal((await call('games/'+id+'/full','PUT',{is_full:true},'other')).status,403);
 assert.equal((await call('games/'+id+'/full','PUT',{is_full:true})).status,200);
 assert.equal((await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'third')).status,409);
 assert.equal((await call('games')).data.games[0].is_full,1);
 await call('games/'+id+'/full','PUT',{is_full:false});assert.equal((await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'third')).status,200);
});

test('messages and venue notifications reach only other accepted members; crowns use identity not name',async()=>{
 const {call,sql}=await fixture();const id=(await call('games','POST',{title:'Notify game',date:singaporeDate(),slot:'evening',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 for(const member of ['other','third'])await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},member);
 const request=(await call('games/'+id+'/requests')).data.requests.find(r=>r.username==='other-secret-name');await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});
 sql.prepare('UPDATE users SET username=?').run('Same name');
 await call('games/'+id+'/messages','POST',{body:'Host message'});
 await call('games/'+id+'/messages','POST',{body:'Guest message'},'other');
 const messages=(await call('games/'+id+'/messages','GET',null,'other')).data.messages;assert.deepEqual(messages.map(m=>Number(m.is_creator)),[1,0]);
 await call('games/'+id+'/venue','PUT',{details:'Private room number'});
 const memberNotes=(await call('notifications','GET',null,'other')).data.notifications;assert.equal(memberNotes.filter(n=>n.kind==='message').length,1);assert.equal(memberNotes.filter(n=>n.kind==='venue').length,1);
 assert.equal((await call('notifications','GET',null,'third')).data.notifications.length,0);
 assert.ok(!JSON.stringify(memberNotes).includes('Private room number'));assert.ok(!JSON.stringify(memberNotes).includes('Host message'));
 const hostBefore=(await call('notifications')).data.unread;await call('notifications/read','POST',{},'other');assert.equal((await call('notifications','GET',null,'other')).data.unread,0);assert.equal((await call('notifications')).data.unread,hostBefore);
 assert.equal((await call('notifications','GET',null,'invalid')).status,401);
});

test('own saved schedule is exposed as an anonymous self contribution even when ready',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T10:30:00Z')});
 const {call}=await fixture();await call('preferences','PUT',{preferences:[{day:1,slot:'evening'}]});await call('presence','PUT',{available:true});
 const data=(await call('discovery')).data;assert.equal(data.self_status,'now');assert.equal(data.self_usual,true);
});


test('Legend avatars default to silhouette, persist with profile, and reject forged IDs',async()=>{
 const {call}=await fixture();assert.equal((await call('me')).data.user.avatar_legend_id,null);
 const profile={username:'Avatar user',area_id:'a',style:'casual',share_condo:true,avatar_legend_id:legends[0].id};
 assert.equal((await call('profile','PUT',profile)).status,200);assert.equal((await call('me')).data.user.avatar_legend_id,legends[0].id);
 assert.equal((await call('profile','PUT',{...profile,avatar_legend_id:'untrusted-url'})).status,400);assert.equal((await call('me')).data.user.avatar_legend_id,legends[0].id);
 await call('profile','PUT',{...profile,avatar_legend_id:null});assert.equal((await call('me')).data.user.avatar_legend_id,null);
});

test('API responses expose server duration without including request secrets',async()=>{
 const {env}=await fixture();const response=await worker.fetch(new Request('https://example.test/api/me',{headers:{Cookie:'rn_session=me'}}),env);
 assert.match(response.headers.get('Server-Timing'),/^app;dur=[0-9.]+$/);
});

test('creator cancellation notifies accepted players after game data is deleted',async()=>{
 const {call,sql}=await fixture();const id=(await call('games','POST',{title:'Cancelled lobby',date:singaporeDate(),start_time:'19:45',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 for(const member of ['other','third'])await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},member);
 const request=(await call('games/'+id+'/requests')).data.requests.find(r=>r.username==='other-secret-name');await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});
 assert.equal((await call('games/'+id,'DELETE',null,'other')).status,403);
 assert.equal((await call('games/'+id,'DELETE')).status,200);assert.equal(sql.prepare('SELECT count(*) n FROM games WHERE id=?').get(id).n,0);
 const notes=(await call('notifications','GET',null,'other')).data.notifications;assert.equal(notes.length,1);assert.equal(notes[0].kind,'cancelled');assert.equal(notes[0].title,'Cancelled lobby');assert.equal(notes[0].game_id,null);
 assert.equal((await call('notifications','GET',null,'third')).data.notifications.length,0);
 await call('notifications/read','POST',{id:notes[0].id},'other');assert.equal((await call('notifications','GET',null,'other')).data.unread,0);
});

test('midnight Singapore cleanup deletes ended-day games but preserves the new day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-20T15:59:00Z')});const {call,sql,env}=await fixture();
 const body={title:'Midnight lobby',start_time:'23:00',venue:'decide',deck_need:'own',extra_decks:false};
 const old=(await call('games','POST',{...body,date:'2026-10-20'})).data.id,next=(await call('games','POST',{...body,date:'2026-10-21'})).data.id;
 await call('games/'+old+'/join','POST',{deck_need:'own',extra_decks:false},'other');await worker.scheduled({},env);
 assert.equal(sql.prepare('SELECT count(*) n FROM games').get().n,2);t.mock.timers.tick(60001);await worker.scheduled({},env);
 assert.equal(sql.prepare('SELECT count(*) n FROM games WHERE id=?').get(old).n,0);assert.equal(sql.prepare('SELECT count(*) n FROM games WHERE id=?').get(next).n,1);assert.equal(sql.prepare('SELECT count(*) n FROM requests WHERE game_id=?').get(old).n,0);
});

test('exact lobby times and selected deck snapshots validate ownership and participant visibility',async()=>{
 const {call,sql}=await fixture();await call('me');const legend=legends[0];
 await call('decks','PUT',{decks:[{legend_id:legend.id,custom_name:'Host deck'}]});await call('decks','PUT',{decks:[{legend_id:legend.id,custom_name:'Guest deck'}]},'other');
 const hostDeck=(await call('me')).data.decks[0],guestDeck=(await call('me','GET',null,'other')).data.decks[0];
 const body={title:'Exact lobby',date:singaporeDate(),start_time:'20:35',venue:'shared',details:'123456 Clubhouse',deck_need:'own',extra_decks:false,deck_ids:[hostDeck.id]};
 assert.equal((await call('games','POST',{...body,start_time:'25:61'})).status,400);assert.equal((await call('games','POST',{...body,venue:'cafe'})).status,400);assert.equal((await call('games','POST',{...body,deck_ids:[guestDeck.id]})).status,400);
 const created=await call('games','POST',body);assert.equal(created.status,201);const id=created.data.id;
 assert.equal((await call('my-games')).data.games[0].start_time,'20:35');assert.equal((await call('games','GET',null,'other')).data.games[0].details,'');
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false,deck_ids:[guestDeck.id]},'other');
 assert.equal((await call('games/'+id+'/decks')).data.decks.length,1);assert.equal((await call('games/'+id+'/decks','GET',null,'other')).status,403);
 const request=(await call('games/'+id+'/requests')).data.requests[0];await call('games/'+id+'/requests','PUT',{id:request.id,status:'accepted'});
 const decks=(await call('games/'+id+'/decks','GET',null,'other')).data.decks;assert.deepEqual(decks.map(d=>d.name).sort(),['Guest deck','Host deck']);assert.equal(decks.filter(d=>d.is_creator).length,1);
 assert.equal((await call('games/'+id+'/location','GET',null,'other')).data.details,'123456 Clubhouse');
 await call('decks','PUT',{decks:[]});assert.equal((await call('games/'+id+'/decks')).data.decks.length,2);
 assert.equal((await call('games/'+id+'/decks','PUT',{deck_ids:[guestDeck.id]})).status,400);
 await call('games/'+id+'/decks','PUT',{deck_ids:[]});assert.equal((await call('games/'+id+'/decks')).data.decks.length,1);
});

test('reading location notifications leaves chat unread and preserves per-game indicators',async()=>{
 const {call}=await fixture();const id=(await call('games','POST',{title:'Unread lobby',date:singaporeDate(),start_time:'18:30',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other');const r=(await call('games/'+id+'/requests')).data.requests[0];await call('games/'+id+'/requests','PUT',{id:r.id,status:'accepted'});
 await call('games/'+id+'/venue','PUT',{details:'New venue'});await call('games/'+id+'/messages','POST',{body:'A message'});
 let g=(await call('my-games','GET',null,'other')).data.games[0];assert.ok(g.unread_venue);assert.ok(g.unread_chat);assert.ok(g.unread);
 await call('notifications/read','POST',{game_id:id,kind:'venue'},'other');g=(await call('my-games','GET',null,'other')).data.games[0];assert.equal(g.unread_venue,false);assert.equal(g.unread_chat,true);
 assert.ok((await call('notifications')).data.unread>0);await call('notifications/read','POST',{game_id:id,kind:'message'},'other');assert.equal((await call('my-games','GET',null,'other')).data.games[0].unread_chat,false);
});

test('leaving removes only your membership and decks, updates counts and revokes private access',async()=>{
 const {call,sql}=await fixture();await call('me');const id=(await call('games','POST',{title:'Leave test',date:singaporeDate(),start_time:'20:00',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other');const r=(await call('games/'+id+'/requests')).data.requests[0];await call('games/'+id+'/requests','PUT',{id:r.id,status:'accepted'});
 sql.prepare('INSERT INTO game_decks VALUES(?,?,?,?,?)').run(id,'other','snapshot',legends[0].id,'Guest deck');
 await call('games/'+id+'/venue','PUT',{details:'Private venue'});
 assert.equal((await call('games/'+id+'/join','DELETE',null,'me')).status,400);assert.equal((await call('games/'+id+'/join','DELETE',null,'third')).status,400);assert.equal((await call('games/'+id+'/join','DELETE',null,'invalid')).status,401);
 assert.equal((await call('games/'+id+'/join','DELETE',null,'other')).status,200);
 assert.equal(sql.prepare('SELECT count(*) n FROM games WHERE id=?').get(id).n,1);assert.equal(sql.prepare('SELECT count(*) n FROM game_decks WHERE game_id=? AND user_id=?').get(id,'other').n,0);
 assert.equal((await call('my-games','GET',null,'other')).data.games.length,0);assert.equal((await call('games')).data.games[0].participant_count,1);
 assert.equal((await call('games/'+id+'/location','GET',null,'other')).status,403);assert.equal((await call('games/'+id+'/messages','GET',null,'other')).status,403);assert.equal((await call('games/'+id+'/decks','GET',null,'other')).status,403);
 assert.equal((await call('notifications','GET',null,'other')).data.notifications.length,0);assert.ok((await call('notifications')).data.notifications.some(n=>n.body==='A player left your game.'));
});

test('pending players can withdraw their request without deleting the game',async()=>{
 const {call}=await fixture();const id=(await call('games','POST',{title:'Withdraw',date:singaporeDate(),start_time:'20:00',venue:'decide',deck_need:'own',extra_decks:false})).data.id;
 await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other');assert.equal((await call('games/'+id+'/join','DELETE',null,'other')).status,200);assert.equal((await call('games/'+id+'/requests')).data.requests.length,0);
 assert.equal((await call('games/'+id+'/join','POST',{deck_need:'own',extra_decks:false},'other')).status,200);
});


test('Morning and Lunch break use Singapore boundaries and all 35 weekly slots are valid',()=>{
 for(const [utc,slot] of [['2026-10-19T21:59:00Z',null],['2026-10-19T22:00:00Z','morning'],['2026-10-20T03:59:00Z','morning'],['2026-10-20T04:00:00Z','lunch'],['2026-10-20T05:59:00Z','lunch'],['2026-10-20T06:00:00Z','afternoon']])assert.equal(singaporeSlot(new Date(utc)),slot);
 assert.ok(preferencesValid(Array.from({length:7},(_,day)=>['morning','lunch','afternoon','evening','late'].map(slot=>({day,slot}))).flat()));
});

test('availability places have independent private schedules and preserve legacy preferences',async()=>{
 const {call,sql}=await fixture();await call('me');sql.prepare('INSERT INTO preferences VALUES(?,?,?,?)').run('me',1,'evening',Math.floor(Date.now()/1000));
 assert.equal((await call('preferences','PUT',{area_id:'b',preferences:[{day:2,slot:'lunch'}]})).status,400);
 assert.equal((await call('availability/locations','POST',{area_id:'b'})).status,400);await call('condos/favourites','PUT',{area_id:'b'});assert.equal((await call('availability/locations','POST',{area_id:'b'})).status,200);
 assert.equal((await call('preferences','PUT',{area_id:'b',preferences:[{day:2,slot:'lunch'}]})).status,200);
 let me=(await call('me')).data;assert.equal(me.preferences[0].slot,'evening');assert.equal(me.location_preferences.length,2);
 assert.equal((await call('me','GET',null,'other')).data.location_preferences.length,0);
 assert.equal((await call('condos/b/schedule')).data.cells.find(c=>c.day===2&&c.slot==='lunch').count,1);
 await call('preferences','PUT',{area_id:'a',preferences:[{day:3,slot:'morning'}]});me=(await call('me')).data;assert.equal(me.location_preferences.length,2);assert.equal(me.preferences[0].slot,'morning');
 assert.equal((await call('availability/locations','DELETE',{area_id:'b'},'other')).status,200);assert.equal((await call('me')).data.location_preferences.length,2);
 await call('availability/locations','DELETE',{area_id:'b'});me=(await call('me')).data;assert.equal(me.location_preferences.length,1);assert.equal(me.location_preferences[0].area_id,'a');
});

test('multiple nearby availability places count the same player once in overall totals',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-20T04:30:00Z')});const {call,sql}=await fixture();await call('me');
 for(const [id,lat] of [['a',1.35],['b',1.351]])sql.prepare('UPDATE areas SET latitude=?,longitude=? WHERE id=?').run(lat,103.87,id);
 for(const area_id of ['a','b']){await call('condos/favourites','PUT',{area_id},'other');await call('availability/locations','POST',{area_id},'other');await call('preferences','PUT',{area_id,preferences:[{day:2,slot:'lunch'}]},'other')}
 const d=(await call('discovery')).data;assert.equal(d.usual_total,1);assert.equal(d.groups.reduce((n,g)=>n+g.usual_count,0),2);assert.ok(!JSON.stringify(d).includes('secret-name'));
});

test('top-bar place moves ready counts and map centre without changing profile or schedules',async()=>{
 const {call,sql}=await fixture();await call('me');for(const [id,lat] of [['a',1.35],['b',1.351]])sql.prepare('UPDATE areas SET latitude=?,longitude=? WHERE id=?').run(lat,103.87,id);
 await call('preferences','PUT',{preferences:[{day:1,slot:'morning'}]});await call('presence','PUT',{available:true});const expiry=(await call('me')).data.user.available_until;
 await call('condos/favourites','PUT',{area_id:'b'});const changed=await call('presence','PUT',{area_id:'b'});assert.equal(changed.status,200);assert.equal(changed.data.available_until,expiry);
 const me=(await call('me')).data;assert.equal(me.user.area_id,'a');assert.equal(me.user.presence_area_id,'b');assert.equal(me.location_preferences[0].area_id,'a');
 assert.equal((await call('discovery')).data.home.name,'Other estate');const others=(await call('discovery','GET',null,'other')).data;assert.equal(others.groups.find(g=>g.id==='b').ready_count,1);assert.equal(others.groups.find(g=>g.id==='a')?.ready_count||0,0);
 const places=(await call('condos','GET',null,'other')).data;assert.equal(places.favourites.find(p=>p.id==='a').available_now,0);
 await call('presence','PUT',{available:false});assert.equal((await call('discovery','GET',null,'other')).data.ready_total,0);
 assert.equal((await call('presence','PUT',{area_id:'forged'})).status,400);assert.equal((await call('me')).data.user.presence_area_id,'b');
});


test('My Places gate both schedules and presence and removal clears contributions',async()=>{
 const {call}=await fixture();await call('me');
 assert.equal((await call('preferences','PUT',{area_id:'b',preferences:[{day:1,slot:'morning'}]})).status,400);
 assert.equal((await call('presence','PUT',{area_id:'b',available:true})).status,400);
 await call('condos/favourites','PUT',{area_id:'b'});
 assert.ok((await call('me')).data.my_places.some(p=>p.id==='b'));
 assert.equal((await call('preferences','PUT',{area_id:'b',preferences:[{day:1,slot:'morning'}]})).status,200);
 await call('presence','PUT',{area_id:'b',available:true});await call('condos/favourites','DELETE',{area_id:'b'});
 let me=(await call('me')).data;assert.equal(me.user.available_until,0);assert.ok(!me.my_places.some(p=>p.id==='b'));assert.ok(!me.location_preferences.some(p=>p.area_id==='b'));
 assert.equal((await call('preferences','PUT',{area_id:'b',preferences:[]})).status,400);
 assert.equal((await call('presence','PUT',{area_id:'b'})).status,400);
 await call('condos/favourites','DELETE',{area_id:'a'});me=(await call('me')).data;assert.equal(me.my_places.length,0);
 assert.equal((await call('preferences','PUT',{preferences:[{day:1,slot:'morning'}]})).status,400);
});
