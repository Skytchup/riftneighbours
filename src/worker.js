import {selectedDecks,saveLobbyDecks,enrichGames,timeSlot,validTime} from './lobbies.js';
import {legends} from '../public/legends.js';
import { SLOTS, singaporeDate, singaporeDay, validDate, preferencesValid, text, deckPreferencesValid } from './domain.js';
import { planningAreas, locationChoices } from './areas.js';
import { oneMap, LocationError } from './onemap.js';
import { ensureSchema } from './schema.js';
import { prepareDecks, deckStatements } from './decks.js';
import { discover, locateArea } from './discovery.js';
import { condoOverview,condoSchedule,condoSearch,registerCondo } from './condos.js';
const locationLimits=new Map();
function allowLocationSearch(uid){
 const time=Date.now(),entry=locationLimits.get(uid);
 if(entry&&entry.until>time){if(entry.count>=30)return false;entry.count++;return true}
 if(locationLimits.size>=1000)locationLimits.delete(locationLimits.keys().next().value);
 locationLimits.set(uid,{count:1,until:time+60000});return true;
}
const json=(v,s=200,h={})=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store',...h}});
const now=()=>Math.floor(Date.now()/1000);
const cookie=(name,value,max)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}; Secure`;
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const cookies=req=>Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(v=>v.trim().split('=')));
export default {async scheduled(event,env){if(env.DB){await ensureSchema(env.DB);await env.DB.batch([env.DB.prepare('DELETE FROM games WHERE date<?').bind(singaporeDate()),env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()),env.DB.prepare('DELETE FROM confirmations WHERE date<?').bind(singaporeDate())])}},async fetch(req,env){const started=performance.now();let response;try{response=await handle(req,env)}catch(e){console.error(e.message);response=json({error:'Something went wrong. Please try again.'},500)}if(new URL(req.url).pathname.startsWith('/api/')){response=new Response(response.body,response);response.headers.set('Server-Timing','app;dur='+(performance.now()-started).toFixed(1));}return response}};
function notify(db,game,actor,kind,body,ownerOnly=false){
 return db.prepare(`INSERT INTO notifications(id,user_id,game_id,kind,body,created_at)
 SELECT lower(hex(randomblob(16))),u.id,g.id,?,?,? FROM users u JOIN games g ON g.id=?
 WHERE u.id!=? AND (u.id=g.user_id ${ownerOnly?'':"OR EXISTS(SELECT 1 FROM requests r WHERE r.game_id=g.id AND r.user_id=u.id AND r.status='accepted')"})
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=u.id AND b.blocked_id=?) OR (b.user_id=? AND b.blocked_id=u.id))`).bind(kind,body,now(),game,actor,actor,actor);
}
async function handle(req,env){
 const url=new URL(req.url),p=url.pathname;
 if(!p.startsWith('/api/')&&!p.startsWith('/auth/'))return env.ASSETS.fetch(req);
 const publicSignup=env.PUBLIC_SIGNUP==='true';
 const configured=Boolean(env.DB&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&(publicSignup||(env.PILOT_GOOGLE_SUBS||'').trim()||(env.PILOT_EMAILS||'').trim()));
 if(p==='/api/status'&&req.method==='GET')return json({loginAvailable:configured});
 const authFailure=reason=>new Response(null,{status:302,headers:{location:'/?signin='+reason,'set-cookie':cookie('oauth_state','',0),'cache-control':'no-store'}});
 if(p.startsWith('/auth/')&&req.method!=='GET')return json({error:'Method not allowed'},405,{Allow:'GET'});
 if(p.startsWith('/auth/')&&!configured)return authFailure('setup');
 if(!env.DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:'Live community is not configured yet. Explore the demo instead.',setupRequired:true},503);
 const origin=env.APP_ORIGIN;
 if(!origin||new URL(origin).origin!==origin)return json({error:'Invalid deployment origin'},503);
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==origin)return json({error:'Invalid origin'},403);
 if(p==='/auth/google'){
  const state=crypto.randomUUID(),u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/callback',response_type:'code',scope:'openid email',state}).toString();
  return new Response(null,{status:302,headers:{location:u.toString(),'set-cookie':cookie('oauth_state',state,600),'cache-control':'no-store'}});
 }
 if(p==='/auth/callback'){
  if(!url.searchParams.get('state')||url.searchParams.get('state')!==cookies(req).oauth_state)return authFailure('expired');
  if(url.searchParams.has('error'))return authFailure('cancelled');
  if(!url.searchParams.get('code'))return authFailure('failed');
  const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:url.searchParams.get('code')||'',client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:origin+'/auth/callback',grant_type:'authorization_code'})});
  const token=await t.json();if(!t.ok||!token.access_token)return authFailure('failed');
  const g=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});const identity=await g.json();if(!g.ok||typeof identity.sub!=='string'||!identity.sub)return authFailure('failed');
  const invitedSubject=(env.PILOT_GOOGLE_SUBS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(identity.sub);
  const invitedEmail=identity.email_verified===true&&typeof identity.email==='string'&&(env.PILOT_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(identity.email.trim().toLowerCase());
  const publicIdentity=publicSignup&&identity.email_verified===true&&typeof identity.email==='string'&&identity.email.trim().length>0;
  if(!publicIdentity&&!invitedSubject&&!invitedEmail)return authFailure('invite');
  await env.DB.prepare('INSERT INTO users(id,google_sub,username,created_at) VALUES(?,?,?,?) ON CONFLICT(google_sub) DO NOTHING').bind(crypto.randomUUID(),identity.sub,'New neighbour',now()).run();
  const user=await env.DB.prepare('SELECT id,area_id FROM users WHERE google_sub=?').bind(identity.sub).first();
  const session=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),user.id,now()+86400*14).run();
  const headers=new Headers({location:origin+(user.area_id?'/#home':'/?welcome=1#profile'),'cache-control':'no-store'});headers.append('set-cookie',cookie('rn_session',session,86400*14));headers.append('set-cookie',cookie('oauth_state','',0));return new Response(null,{status:302,headers});
 }
 const user=await env.DB.prepare('SELECT u.id,u.username,u.area_id,u.style,u.share_condo FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(cookies(req).rn_session||''),now()).first();
 if(!user)return json({error:'Please sign in'},401);
 const db=env.DB,uid=user.id;
 await ensureSchema(db);
 Object.assign(user,await db.prepare('SELECT available_until,share_map,avatar_legend_id FROM users WHERE id=?').bind(uid).first());
 if(p==='/api/notifications'&&req.method==='GET'){
  const notifications=(await db.prepare(`SELECT n.id,n.game_id,n.kind,n.body,n.created_at,n.read_at,g.title FROM notifications n JOIN games g ON g.id=n.game_id WHERE n.user_id=?
  UNION ALL SELECT id,NULL game_id,'cancelled' kind,body,created_at,read_at,title FROM cancellation_notices WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50`).bind(uid,uid).all()).results;
  const unread=(await db.prepare('SELECT (SELECT count(*) FROM notifications WHERE user_id=? AND read_at IS NULL)+(SELECT count(*) FROM cancellation_notices WHERE user_id=? AND read_at IS NULL) n').bind(uid,uid).first()).n;return json({notifications,unread});
 }
 if(p==='/api/notifications/read'&&req.method==='POST'){
  const b=await readPresence(req);
  if(b.id){await db.batch([db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND id=?').bind(now(),uid,b.id),db.prepare('UPDATE cancellation_notices SET read_at=? WHERE user_id=? AND id=?').bind(now(),uid,b.id)])}
  else if(b.game_id){
   if(b.kind&&!['venue','message','decks','join_request','request_update'].includes(b.kind))return json({error:'Invalid notification category'},400);
   await db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND game_id=? AND read_at IS NULL'+(b.kind?" AND (kind=? OR kind='request_update')":'')).bind(now(),uid,b.game_id,...(b.kind?[b.kind]:[])).run();
  }else await db.batch([db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now(),uid),db.prepare('UPDATE cancellation_notices SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now(),uid)]);
  return json({ok:true});
 }
 if(p==='/api/presence'&&req.method==='PUT'){
  const b=await readPresence(req);
  if(!user.area_id)return json({error:'Choose your location in Profile first.'},400);
  if(typeof b.available!=='boolean'&&typeof b.share_map!=='boolean')return json({error:'Choose your availability or map visibility.'},400);
  if(b.share_map===true&&user.area_id.startsWith('sg-pa-'))return json({error:'Select your selected place in Profile before sharing your map location.'},400);
  const until=typeof b.available==='boolean'?(b.available?now()+7200:0):user.available_until;
  const sharing=typeof b.share_map==='boolean'?(b.share_map?1:0):user.share_map;
  await db.prepare('UPDATE users SET available_until=?,share_map=? WHERE id=?').bind(until,sharing,uid).run();
  if(sharing)await locateArea(env,user.area_id);
  return json({available_until:until,share_map:sharing});
 }
 if(p==='/api/discovery'&&req.method==='GET'){
  if(!user.area_id)return json({error:'Choose your location in Profile first.'},400);
  const radius=Number(url.searchParams.get('radius')||5);
  if(![2,5,10,20].includes(radius))return json({error:'Choose a valid search radius.'},400);
  return json(await discover(env,user,{scope:url.searchParams.get('scope')==='condo'?'condo':'area',radius}));
 }
 if(p==='/api/logout'&&req.method==='POST'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(cookies(req).rn_session||'')).run();return json({ok:true},200,{'set-cookie':cookie('rn_session','',0)})}
 const read=async()=>{if(Number(req.headers.get('content-length'))>12000)throw Error('body too large');const raw=await req.text();if(raw.length>12000)throw Error('body too large');return JSON.parse(raw)};
 if(p==='/api/condos'&&req.method==='GET')return json(await condoOverview(env,user));
 if(p==='/api/condos/search'&&req.method==='GET'){
  const query=(url.searchParams.get('q')||'').trim();
  if(!text(query,100)||query.length<3)return json({error:'Enter at least 3 characters of a place name or postal code.'},400);
  if(!allowLocationSearch(uid))return json({error:'Please wait a minute before searching again.'},429);
  return json(await condoSearch(env,query));
 }
 if(p==='/api/condos/select'&&req.method==='POST'){
  const b=await read();
  if(!b||!text(b.query,100)||!text(b.id,24))return json({error:'Select a valid search result.'},400);
  if(!allowLocationSearch(uid))return json({error:'Please wait a minute before selecting another result.'},429);
  try{return json({area:await registerCondo(env,b)})}catch(error){return json({error:error instanceof LocationError?error.message:'This location could not be loaded. Please try again.'},503)}
 }
 if(p==='/api/condos/favourites'&&['PUT','DELETE'].includes(req.method)){
  const b=await read();
  if(!b||!text(b.area_id,100)||b.area_id.startsWith('sg-pa-')||!await db.prepare('SELECT id FROM areas WHERE id=?').bind(b.area_id).first())return json({error:'Choose a place from the search results.'},400);
  if(req.method==='DELETE')await db.prepare('DELETE FROM condo_favourites WHERE user_id=? AND area_id=?').bind(uid,b.area_id).run();
  else{
   const count=await db.prepare('SELECT COUNT(*) n FROM condo_favourites WHERE user_id=?').bind(uid).first();
   if(count.n>=30&&!await db.prepare('SELECT 1 FROM condo_favourites WHERE user_id=? AND area_id=?').bind(uid,b.area_id).first())return json({error:'You can save up to 30 favourite places.'},400);
   await db.prepare('INSERT OR IGNORE INTO condo_favourites(user_id,area_id,created_at) VALUES(?,?,?)').bind(uid,b.area_id,now()).run();
  }
  return json({ok:true});
 }
 const condoMatch=p.match(/^\/api\/condos\/([a-zA-Z0-9-]+)\/schedule$/);
 if(condoMatch&&req.method==='GET'){
  const schedule=await condoSchedule(db,user,condoMatch[1]);return schedule?json(schedule):json({error:'Place not found.'},404);
 }
 if(p==='/api/locations'&&req.method==='GET'){
  const query=url.searchParams.get('q')||'';
  if(!text(query,100)||query.trim().length<3)return json({error:'Enter 3–100 characters of a place name or postal code.'},400);
  if(!allowLocationSearch(uid))return json({error:'Please wait a minute before searching again.'},429);
  try{return json({results:await oneMap(env).search(query),source:'OneMap / Singapore Land Authority'})}
  catch(error){if(error instanceof LocationError)return json({error:error.message},503);throw error}
 }
 if(p==='/api/me'&&req.method==='GET'){
  const [preferences,decks,confirmations,areas,locations,allPreferences]=await Promise.all([
   db.prepare('SELECT day,slot FROM availability_records WHERE user_id=? AND area_id=?').bind(uid,user.area_id).all(),
   db.prepare('SELECT id,name,legend_id,custom_name FROM decks WHERE user_id=?').bind(uid).all(),
   db.prepare('SELECT date,slot FROM confirmations WHERE user_id=? AND date>=?').bind(uid,singaporeDate()).all(),
   db.prepare('SELECT * FROM areas ORDER BY neighbourhood,name').all(),
   db.prepare('SELECT a.* FROM areas a JOIN availability_locations l ON l.area_id=a.id WHERE l.user_id=? ORDER BY a.name').bind(uid).all(),
   db.prepare('SELECT area_id,day,slot FROM availability_records WHERE user_id=?').bind(uid).all()
  ]);return json({user,preferences:preferences.results,decks:decks.results,confirmations:confirmations.results,areas:locationChoices(areas.results),availability_locations:locations.results,location_preferences:allPreferences.results});
 }
 if(p==='/api/profile'&&req.method==='PUT'){
  const b=await read();
  const avatar=b.avatar_legend_id===undefined?user.avatar_legend_id:b.avatar_legend_id;
  if(avatar!==null&&avatar!==undefined&&!legends.some(l=>l.id===avatar))return json({error:'Choose a valid Legend avatar.'},400);
  const decks=b.decks===undefined?undefined:prepareDecks(b.decks);
  if(decks===null)return json({error:'Choose a valid Legend for each deck; deck names are optional (60 characters maximum).'},400);
  if(!text(b.username,30)||!['casual','learning','teaching'].includes(b.style)||!text(b.area_id,100)||(b.condo_name!==undefined&&(typeof b.condo_name!=='string'||b.condo_name.length>100)))return json({error:'Choose a username, area and play style'},400);
  const planning=planningAreas.find(a=>a.id===b.area_id);
  let selected=planning||await db.prepare('SELECT * FROM areas WHERE id=?').bind(b.area_id).first();
  if(!selected)return json({error:'Choose a location from the list'},400);
  if(b.condo_name&& !b.onemap_selection)return json({error:'Choose your selected place from OneMap search results.'},400);
  let condo='',geometry=null;
  if(b.onemap_selection!==undefined){
   const choice=b.onemap_selection;
   if(!planning||!choice||!text(choice.query,100)||!text(choice.id,24))return json({error:'Choose a neighbourhood and search result again.'},400);
   if(!allowLocationSearch(uid))return json({error:'Please wait a minute before saving this search result.'},429);
   try{
    const result=(await oneMap(env).search(choice.query)).find(a=>a.id===choice.id);
    if(!result)return json({error:'That location is no longer in the search results. Please search again.'},400);
    condo=result.name;
    if(result.latitude!=null&&result.longitude!=null)geometry=result;
   }catch(error){if(error instanceof LocationError)return json({error:error.message},503);throw error}
  }
  if(condo&&!planning)return json({error:'Choose a neighbourhood before adding your selected place'},400);
  if(condo)selected={id:'sg-condo-'+(await hash(planning.id+'|'+condo.toLowerCase())).slice(0,24),name:condo,neighbourhood:planning.name};
  const share=b.share_condo===true&&!selected.id.startsWith('sg-pa-')?1:0;
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO areas(id,name,neighbourhood) VALUES(?,?,?)').bind(selected.id,selected.name,selected.neighbourhood),
   ...(geometry?[db.prepare('UPDATE areas SET latitude=COALESCE(latitude,?),longitude=COALESCE(longitude,?),address=CASE WHEN address=\'\' THEN ? ELSE address END,postal=CASE WHEN postal=\'\' THEN ? ELSE postal END WHERE id=?').bind(geometry.latitude,geometry.longitude,geometry.address,geometry.postal,selected.id)]:[]),
   db.prepare('UPDATE users SET username=?,area_id=?,style=?,share_condo=?,share_map=?,avatar_legend_id=? WHERE id=?').bind(b.username.trim(),selected.id,b.style,share,selected.id.startsWith('sg-pa-')?0:(b.share_map===undefined?user.share_map:b.share_map===true?1:0),avatar??null,uid),
   ...(decks===undefined?[]:deckStatements(db,uid,decks))
  ]);
  return json({ok:true,area:{...selected,kind:selected.id.startsWith('sg-pa-')?'neighbourhood':'condo'},decks:(await db.prepare('SELECT id,name,legend_id,custom_name FROM decks WHERE user_id=?').bind(uid).all()).results});
 }
 if(p==='/api/availability/locations'&&['POST','DELETE'].includes(req.method)){
  const b=await read();if(!text(b.area_id,100))return json({error:'Choose a place.'},400);
  const planning=planningAreas.find(a=>a.id===b.area_id),area=planning||await db.prepare('SELECT * FROM areas WHERE id=?').bind(b.area_id).first();if(!area)return json({error:'Choose a saved place or a OneMap result.'},400);
  if(req.method==='DELETE'){
   await db.batch([db.prepare('DELETE FROM place_preferences WHERE user_id=? AND area_id=?').bind(uid,area.id),db.prepare('DELETE FROM availability_locations WHERE user_id=? AND area_id=?').bind(uid,area.id),...(area.id===user.area_id?[db.prepare('DELETE FROM preferences WHERE user_id=?').bind(uid)]:[])]);return json({ok:true});
  }
  const count=await db.prepare('SELECT count(*) n FROM availability_locations WHERE user_id=?').bind(uid).first();if(count.n>=10&&!await db.prepare('SELECT 1 FROM availability_locations WHERE user_id=? AND area_id=?').bind(uid,area.id).first())return json({error:'You can save up to ten availability places.'},400);
  await db.batch([db.prepare('INSERT OR IGNORE INTO areas(id,name,neighbourhood) VALUES(?,?,?)').bind(area.id,area.name,area.neighbourhood||area.name),db.prepare('INSERT OR IGNORE INTO availability_locations VALUES(?,?)').bind(uid,area.id)]);return json({ok:true,area});
 }
 if(p==='/api/preferences'&&req.method==='PUT'){
  const b=await read(),areaId=b.area_id||user.area_id;if(!preferencesValid(b.preferences)||!text(areaId,100))return json({error:'Choose a place and valid availability.'},400);
  const area=await db.prepare('SELECT * FROM areas WHERE id=?').bind(areaId).first();if(!area)return json({error:'Add this place to your availability first.'},400);
  if(areaId!==user.area_id&&!await db.prepare('SELECT 1 FROM availability_locations WHERE user_id=? AND area_id=?').bind(uid,areaId).first())return json({error:'Add this place to your availability first.'},400);
  await db.batch([...(areaId===user.area_id?[db.prepare('DELETE FROM preferences WHERE user_id=?').bind(uid)]:[]),db.prepare('DELETE FROM place_preferences WHERE user_id=? AND area_id=?').bind(uid,areaId),db.prepare('INSERT OR IGNORE INTO availability_locations VALUES(?,?)').bind(uid,areaId),...b.preferences.map(x=>db.prepare('INSERT INTO place_preferences VALUES(?,?,?,?,?)').bind(uid,areaId,x.day,x.slot,now()))]);return json({ok:true});
 }
 if(p==='/api/tonight'&&req.method==='PUT'){
  const b=await read();if(!['afternoon','evening','late'].includes(b.slot)||typeof b.available!=='boolean')return json({error:'Invalid confirmation'},400);
  await db.prepare(b.available?'INSERT OR IGNORE INTO confirmations VALUES(?,?,?)':'DELETE FROM confirmations WHERE user_id=? AND date=? AND slot=?').bind(uid,singaporeDate(),b.slot).run();return json({ok:true});
 }
 if(p==='/api/decks'&&req.method==='PUT'){
  const b=await read(),decks=prepareDecks(b.decks);if(!decks)return json({error:'Choose a valid Legend and an optional deck name (60 characters maximum).'},400);
  await db.batch(deckStatements(db,uid,decks));return json({ok:true});
 }
 if(!user.area_id)return json({error:'Set your area in your profile first'},400);
 const visible=`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`;
 if(p==='/api/nearby'&&req.method==='GET'){
  const scope=url.searchParams.get('scope')==='condo'?'condo':'area',today=singaporeDate();
  const area=await db.prepare('SELECT * FROM areas WHERE id=?').bind(user.area_id).first();
  if(scope==='condo'&&!user.share_condo)return json({error:'Select a shared place to use this group'},403);
  const clause=scope==='condo'?'u.area_id=? AND u.share_condo=1':'a.neighbourhood=?';const loc=scope==='condo'?user.area_id:area.neighbourhood;
  const counts=[];
  for(const slot of SLOTS){const base=`FROM users u JOIN areas a ON a.id=u.area_id WHERE u.id!=? AND ${clause} AND ${visible}`;
   const usual=await db.prepare(`SELECT count(*) n ${base} AND EXISTS(SELECT 1 FROM availability_records f WHERE f.user_id=u.id AND f.area_id=a.id AND f.day=? AND f.slot=? AND f.updated_at>?)`).bind(uid,loc,uid,uid,singaporeDay(today),slot,now()-86400*60).first();
   const confirmed=await db.prepare(`SELECT count(*) n ${base} AND EXISTS(SELECT 1 FROM confirmations c WHERE c.user_id=u.id AND c.date=? AND c.slot=?)`).bind(uid,loc,uid,uid,today,slot).first();
   // Low counts are bands, never exact identities or routines.
   const band=n=>n===0?'0':n<3?'1–2':String(n);
   counts.push({slot,usual:band(usual.n),confirmed:band(confirmed.n)});
  }return json({counts,date:today,scope});
 }
 if(p==='/api/games'&&req.method==='GET'){
  const rows=(await db.prepare(`SELECT g.id,g.user_id,g.title,g.date,g.slot,g.venue,g.deck_need,g.extra_decks,g.is_full,g.start_time,(SELECT status FROM requests WHERE game_id=g.id AND user_id=?) request_status,1+(SELECT count(*) FROM requests WHERE game_id=g.id AND status='accepted') participant_count FROM games g JOIN users u ON u.id=g.user_id JOIN areas a ON a.id=g.area_id WHERE a.neighbourhood=(SELECT neighbourhood FROM areas WHERE id=?) AND g.date>=? AND ${visible} ORDER BY g.date,g.created_at LIMIT 50`).bind(uid,user.area_id,singaporeDate(),uid,uid).all()).results;
  return json({games:await enrichGames(db,uid,rows)});
 }
 if(p==='/api/games'&&req.method==='POST'){
  const b=await read(),start=b.start_time??({afternoon:'14:00',evening:'18:00',late:'21:00'}[b.slot]);
  if(!text(b.title,80)||!validDate(b.date)||b.date<singaporeDate()||!validTime(start)||!['decide','shared'].includes(b.venue)||!deckPreferencesValid(b)||(b.details!==undefined&&(typeof b.details!=='string'||b.details.length>500)))return json({error:'Check lobby name, date, time and venue'},400);
  const decks=await selectedDecks(db,uid,b.deck_ids);if(!decks||(b.deck_need==='need'&&decks.length))return json({error:'Select your own decks, or request a borrowed deck.'},400);
  const recent=await db.prepare('SELECT count(*) n FROM games WHERE user_id=? AND created_at>?').bind(uid,now()-86400).first();if(recent.n>=5)return json({error:'Please limit creations to five per day'},429);
  const id=crypto.randomUUID();await db.batch([db.prepare('INSERT INTO games(id,user_id,area_id,title,date,slot,venue,details,created_at,deck_need,extra_decks,start_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,uid,user.area_id,b.title.trim(),b.date,timeSlot(start),b.venue,b.venue==='shared'?(b.details||'').trim():'',now(),b.deck_need,b.extra_decks?1:0,start),...saveLobbyDecks(db,id,uid,decks)]);return json({id},201);
 }
 const match=p.match(/^\/api\/games\/([a-zA-Z0-9-]+)(?:\/(join|requests|messages|venue|full|decks|location))?$/);
 if(match){const id=match[1],action=match[2];const game=await db.prepare('SELECT g.*,u.username FROM games g JOIN users u ON u.id=g.user_id WHERE g.id=?').bind(id).first();if(!game)return json({error:'Game not found'},404);
  const blocked=await db.prepare('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)').bind(uid,game.user_id,game.user_id,uid).first();if(blocked)return json({error:'Game unavailable'},404);
  const owner=game.user_id===uid;const request=await db.prepare('SELECT status FROM requests WHERE game_id=? AND user_id=?').bind(id,uid).first();const participant=owner||request?.status==='accepted';
  if(!action&&req.method==='DELETE'&&owner){
   await db.batch([db.prepare(`INSERT INTO cancellation_notices(id,user_id,title,body,created_at) SELECT lower(hex(randomblob(16))),r.user_id,?,'The organiser cancelled this game.',? FROM requests r WHERE r.game_id=? AND r.status='accepted'`).bind(game.title,now(),id),db.prepare('DELETE FROM games WHERE id=?').bind(id)]);return json({ok:true});
  }
  if(action==='location'&&participant&&req.method==='GET')return json({details:game.details});
  if(action==='decks'&&participant){
   if(req.method==='GET')return json({decks:(await db.prepare(`SELECT d.user_id,d.deck_key,d.legend_id,d.name,u.username,(d.user_id=?) is_creator FROM game_decks d JOIN users u ON u.id=d.user_id WHERE d.game_id=? AND (d.user_id=? OR EXISTS(SELECT 1 FROM requests r WHERE r.game_id=d.game_id AND r.user_id=d.user_id AND r.status='accepted')) ORDER BY u.username,d.name`).bind(game.user_id,id,game.user_id).all()).results});
   if(req.method==='PUT'){const b=await read(),decks=await selectedDecks(db,uid,b.deck_ids);if(!decks||(b.deck_need==='need'&&decks.length))return json({error:'Select your own decks, or request a borrowed deck.'},400);await db.batch([...saveLobbyDecks(db,id,uid,decks),notify(db,id,uid,'decks','The decks for your game changed.')]);return json({ok:true})}
  }
  if(action==='join'&&req.method==='DELETE'){
   if(owner||!request)return json({error:owner?'Organisers can delete the game instead.':'You are not part of this game.'},400);
   await db.batch([
    ...(request.status==='accepted'?[notify(db,id,uid,'join_request','A player left your game.',true)]:[]),
    db.prepare('DELETE FROM game_decks WHERE game_id=? AND user_id=?').bind(id,uid),
    db.prepare('DELETE FROM requests WHERE game_id=? AND user_id=?').bind(id,uid),
    db.prepare('DELETE FROM notifications WHERE game_id=? AND user_id=?').bind(id,uid)
   ]);return json({ok:true});
  }
  if(action==='full'&&owner&&req.method==='PUT'){const b=await read();if(typeof b.is_full!=='boolean')return json({error:'Choose a valid event status'},400);await db.prepare('UPDATE games SET is_full=? WHERE id=?').bind(b.is_full?1:0,id).run();return json({ok:true,is_full:b.is_full})}
  if(action==='join'&&req.method==='POST'){
   const allowed=await db.prepare('SELECT 1 FROM areas a JOIN areas b ON a.neighbourhood=b.neighbourhood WHERE a.id=? AND b.id=?').bind(user.area_id,game.area_id).first();if(!allowed||owner||game.date<singaporeDate())return json({error:'Cannot join this game'},400);
   if(game.is_full&&request?.status!=='accepted')return json({error:'This event is full'},409);
   const b=await read();if(!deckPreferencesValid(b))return json({error:'Choose whether you need a deck'},400);
   const decks=await selectedDecks(db,uid,b.deck_ids);if(!decks||(b.deck_need==='need'&&decks.length))return json({error:'Select your own decks, or request a borrowed deck.'},400);
   const statement=db.prepare(`INSERT INTO requests(id,game_id,user_id,status,deck_need,extra_decks) VALUES(?,?,?,?,?,?) ON CONFLICT(game_id,user_id) DO UPDATE SET status=CASE WHEN requests.status='declined' THEN 'pending' ELSE requests.status END,deck_need=excluded.deck_need,extra_decks=excluded.extra_decks`).bind(crypto.randomUUID(),id,uid,'pending',b.deck_need,b.extra_decks?1:0);
   await db.batch([statement,...saveLobbyDecks(db,id,uid,decks),...(!request||request.status==='declined'?[notify(db,id,uid,'join_request','Someone asked to join your game.',true)]:[])]);return json({ok:true});
  }
  if(action==='requests'&&owner){
   if(req.method==='GET')return json({requests:(await db.prepare('SELECT r.id,r.status,r.deck_need,r.extra_decks,u.username FROM requests r JOIN users u ON u.id=r.user_id WHERE game_id=?').bind(id).all()).results});
   if(req.method==='PUT'){
    const b=await read();if(!['accepted','declined'].includes(b.status))return json({error:'Invalid decision'},400);
    const target=await db.prepare('SELECT user_id,status FROM requests WHERE id=? AND game_id=?').bind(b.id,id).first();if(!target)return json({error:'Request not found'},404);
    if(game.is_full&&b.status==='accepted'&&target.status!=='accepted')return json({error:'Reopen the event before accepting more players.'},409);
    await db.batch([db.prepare('UPDATE requests SET status=? WHERE id=? AND game_id=?').bind(b.status,b.id,id),...(target.status!==b.status?[db.prepare('INSERT INTO notifications(id,user_id,game_id,kind,body,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),target.user_id,id,'request_update',b.status==='accepted'?'You joined the game.':'Your join request was declined.',now())]:[])]);return json({ok:true});
   }
  }
  if(action==='venue'&&owner&&req.method==='PUT'){const b=await read();if(!text(b.details,500))return json({error:'Enter meeting instructions'},400);await db.batch([db.prepare('UPDATE games SET details=? WHERE id=?').bind(b.details.trim(),id),notify(db,id,uid,'venue','The organiser updated the meeting location.')]);return json({ok:true})}
  if(action==='messages'&&participant){
   if(req.method==='GET')return json({messages:(await db.prepare('SELECT m.body,m.created_at,u.username,(m.user_id=?) is_creator FROM messages m JOIN users u ON u.id=m.user_id WHERE game_id=? ORDER BY m.created_at LIMIT 100').bind(game.user_id,id).all()).results,details:game.details});
   if(req.method==='POST'){const b=await read();if(!text(b.body,500))return json({error:'Message must be 1–500 characters'},400);const recent=await db.prepare('SELECT count(*) n FROM messages WHERE user_id=? AND created_at>?').bind(uid,now()-60).first();if(recent.n>=10)return json({error:'Please wait before sending more messages'},429);await db.batch([db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,uid,b.body.trim(),now()),notify(db,id,uid,'message','New message in your game.')]);return json({ok:true})}
  }
  return json({error:'Not allowed'},403);
 }
 if(p==='/api/my-games'&&req.method==='GET'){
  const rows=(await db.prepare(`SELECT g.id,g.title,g.date,g.slot,g.user_id,g.deck_need,g.extra_decks,g.is_full,g.start_time,1+(SELECT count(*) FROM requests WHERE game_id=g.id AND status='accepted') participant_count,r.status,r.deck_need AS request_deck_need,r.extra_decks AS request_extra_decks FROM games g LEFT JOIN requests r ON r.game_id=g.id AND r.user_id=? WHERE (g.user_id=? OR r.user_id=?) AND g.date>=? ORDER BY g.date,g.start_time LIMIT 50`).bind(uid,uid,uid,singaporeDate()).all()).results;
  return json({games:await enrichGames(db,uid,rows)});
 }
 if(p==='/api/blocks'&&req.method==='POST'){const b=await read();if(!text(b.user_id,80)||b.user_id===uid)return json({error:'Invalid member'},400);await db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').bind(uid,b.user_id).run();return json({ok:true})}
 if(p==='/api/report'&&req.method==='POST'){const b=await read();if(!text(b.reason,500)||!text(b.game_id,80))return json({error:'Enter a reason'},400);const recent=await db.prepare('SELECT count(*) n FROM reports WHERE user_id=? AND created_at>?').bind(uid,now()-3600).first();if(recent.n>=5)return json({error:'Report limit reached'},429);await db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),uid,b.game_id,b.reason,now()).run();return json({ok:true})}
 if(p==='/api/account'&&req.method==='DELETE'){await db.batch([db.prepare('DELETE FROM games WHERE user_id=?').bind(uid),db.prepare('DELETE FROM users WHERE id=?').bind(uid)]);return json({ok:true},200,{'set-cookie':cookie('rn_session','',0)})}
 return json({error:'Not found'},404);
}
async function readPresence(req){const raw=await req.text();if(raw.length>1000)throw Error('body too large');return JSON.parse(raw)}
