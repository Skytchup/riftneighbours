import { SLOTS, singaporeDate, singaporeDay, validDate, preferencesValid, text, deckPreferencesValid } from './domain.js';
const json=(v,s=200,h={})=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store',...h}});
const now=()=>Math.floor(Date.now()/1000);
const cookie=(name,value,max)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}; Secure`;
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const cookies=req=>Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(v=>v.trim().split('=')));
export default {async scheduled(event,env){if(env.DB)await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()),env.DB.prepare('DELETE FROM confirmations WHERE date<?').bind(singaporeDate())])},async fetch(req,env){try{return await handle(req,env)}catch(e){console.error(e.message);return json({error:'Something went wrong. Please try again.'},500)}}};
async function handle(req,env){
 const url=new URL(req.url),p=url.pathname;
 if(!p.startsWith('/api/')&&!p.startsWith('/auth/'))return env.ASSETS.fetch(req);
 const configured=Boolean(env.DB&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&((env.PILOT_GOOGLE_SUBS||'').trim()||(env.PILOT_EMAILS||'').trim()));
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
  if(!invitedSubject&&!invitedEmail)return authFailure('invite');
  await env.DB.prepare('INSERT INTO users(id,google_sub,username,created_at) VALUES(?,?,?,?) ON CONFLICT(google_sub) DO NOTHING').bind(crypto.randomUUID(),identity.sub,'New neighbour',now()).run();
  const user=await env.DB.prepare('SELECT id,area_id FROM users WHERE google_sub=?').bind(identity.sub).first();
  const session=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(session),user.id,now()+86400*14).run();
  const headers=new Headers({location:origin+(user.area_id?'/#nearby':'/?welcome=1#profile'),'cache-control':'no-store'});headers.append('set-cookie',cookie('rn_session',session,86400*14));headers.append('set-cookie',cookie('oauth_state','',0));return new Response(null,{status:302,headers});
 }
 const user=await env.DB.prepare('SELECT u.id,u.username,u.area_id,u.style,u.share_condo FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(cookies(req).rn_session||''),now()).first();
 if(!user)return json({error:'Please sign in'},401);
 const db=env.DB,uid=user.id;
 if(p==='/api/logout'&&req.method==='POST'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(cookies(req).rn_session||'')).run();return json({ok:true},200,{'set-cookie':cookie('rn_session','',0)})}
 const read=async()=>{if(Number(req.headers.get('content-length'))>12000)throw Error('body too large');const raw=await req.text();if(raw.length>12000)throw Error('body too large');return JSON.parse(raw)};
 if(p==='/api/me'&&req.method==='GET')return json({user,preferences:(await db.prepare('SELECT day,slot FROM preferences WHERE user_id=?').bind(uid).all()).results,decks:(await db.prepare('SELECT id,name FROM decks WHERE user_id=?').bind(uid).all()).results,confirmations:(await db.prepare('SELECT date,slot FROM confirmations WHERE user_id=? AND date>=?').bind(uid,singaporeDate()).all()).results,areas:(await db.prepare('SELECT * FROM areas ORDER BY neighbourhood,name').all()).results});
 if(p==='/api/profile'&&req.method==='PUT'){
  const b=await read();if(!text(b.username,30)||!['casual','learning','teaching'].includes(b.style)||!await db.prepare('SELECT id FROM areas WHERE id=?').bind(b.area_id).first())return json({error:'Choose a username, area and play style'},400);
  await db.prepare('UPDATE users SET username=?,area_id=?,style=?,share_condo=? WHERE id=?').bind(b.username.trim(),b.area_id,b.style,b.share_condo===true?1:0,uid).run();return json({ok:true});
 }
 if(p==='/api/preferences'&&req.method==='PUT'){
  const b=await read();if(!preferencesValid(b.preferences))return json({error:'Invalid availability'},400);
  await db.batch([db.prepare('DELETE FROM preferences WHERE user_id=?').bind(uid),...b.preferences.map(x=>db.prepare('INSERT INTO preferences VALUES(?,?,?,?)').bind(uid,x.day,x.slot,now()))]);return json({ok:true});
 }
 if(p==='/api/tonight'&&req.method==='PUT'){
  const b=await read();if(!SLOTS.includes(b.slot)||typeof b.available!=='boolean')return json({error:'Invalid confirmation'},400);
  await db.prepare(b.available?'INSERT OR IGNORE INTO confirmations VALUES(?,?,?)':'DELETE FROM confirmations WHERE user_id=? AND date=? AND slot=?').bind(uid,singaporeDate(),b.slot).run();return json({ok:true});
 }
 if(p==='/api/decks'&&req.method==='PUT'){
  const b=await read();if(!Array.isArray(b.decks)||b.decks.length>12||!b.decks.every(d=>text(d.name,60)))return json({error:'Invalid deck list'},400);
  await db.batch([db.prepare('DELETE FROM decks WHERE user_id=?').bind(uid),...b.decks.map(d=>db.prepare('INSERT INTO decks VALUES(?,?,?,?)').bind(crypto.randomUUID(),uid,d.name.trim(),0))]);return json({ok:true});
 }
 if(!user.area_id)return json({error:'Set your area in your profile first'},400);
 const visible=`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`;
 if(p==='/api/nearby'&&req.method==='GET'){
  const scope=url.searchParams.get('scope')==='condo'?'condo':'area',today=singaporeDate();
  const area=await db.prepare('SELECT * FROM areas WHERE id=?').bind(user.area_id).first();
  if(scope==='condo'&&!user.share_condo)return json({error:'Enable condo sharing to use this group'},403);
  const clause=scope==='condo'?'u.area_id=? AND u.share_condo=1':'a.neighbourhood=?';const loc=scope==='condo'?user.area_id:area.neighbourhood;
  const counts=[];
  for(const slot of SLOTS){const base=`FROM users u JOIN areas a ON a.id=u.area_id WHERE u.id!=? AND ${clause} AND ${visible}`;
   const usual=await db.prepare(`SELECT count(*) n ${base} AND EXISTS(SELECT 1 FROM preferences f WHERE f.user_id=u.id AND f.day=? AND f.slot=? AND f.updated_at>?)`).bind(uid,loc,uid,uid,singaporeDay(today),slot,now()-86400*60).first();
   const confirmed=await db.prepare(`SELECT count(*) n ${base} AND EXISTS(SELECT 1 FROM confirmations c WHERE c.user_id=u.id AND c.date=? AND c.slot=?)`).bind(uid,loc,uid,uid,today,slot).first();
   // Low counts are bands, never exact identities or routines.
   const band=n=>n===0?'0':n<3?'1–2':String(n);
   counts.push({slot,usual:band(usual.n),confirmed:band(confirmed.n)});
  }return json({counts,date:today,scope});
 }
 if(p==='/api/games'&&req.method==='GET'){
  const rows=(await db.prepare(`SELECT g.id,g.user_id,g.title,g.date,g.slot,g.venue,g.deck_need,g.extra_decks FROM games g JOIN users u ON u.id=g.user_id JOIN areas a ON a.id=g.area_id WHERE a.neighbourhood=(SELECT neighbourhood FROM areas WHERE id=?) AND g.date>=? AND ${visible} ORDER BY g.date,g.created_at LIMIT 50`).bind(user.area_id,singaporeDate(),uid,uid).all()).results;
  return json({games:rows});
 }
 if(p==='/api/games'&&req.method==='POST'){
  const b=await read();if(!text(b.title,80)||!validDate(b.date)||b.date<singaporeDate()||!SLOTS.includes(b.slot)||!['decide','shared','cafe'].includes(b.venue)||!deckPreferencesValid(b))return json({error:'Check title, date and venue'},400);
  const recent=await db.prepare('SELECT count(*) n FROM games WHERE user_id=? AND created_at>?').bind(uid,now()-86400).first();if(recent.n>=5)return json({error:'Please limit suggestions to five per day'},429);
  const id=crypto.randomUUID();await db.prepare('INSERT INTO games(id,user_id,area_id,title,date,slot,venue,details,created_at,deck_need,extra_decks) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,uid,user.area_id,b.title.trim(),b.date,b.slot,b.venue,'',now(),b.deck_need,b.extra_decks?1:0).run();return json({id},201);
 }
 const match=p.match(/^\/api\/games\/([a-zA-Z0-9-]+)(?:\/(join|requests|messages|venue))?$/);
 if(match){const id=match[1],action=match[2];const game=await db.prepare('SELECT g.*,u.username FROM games g JOIN users u ON u.id=g.user_id WHERE g.id=?').bind(id).first();if(!game)return json({error:'Game not found'},404);
  const blocked=await db.prepare('SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)').bind(uid,game.user_id,game.user_id,uid).first();if(blocked)return json({error:'Game unavailable'},404);
  const owner=game.user_id===uid;const request=await db.prepare('SELECT status FROM requests WHERE game_id=? AND user_id=?').bind(id,uid).first();const participant=owner||request?.status==='accepted';
  if(action==='join'&&req.method==='POST'){
   const allowed=await db.prepare('SELECT 1 FROM areas a JOIN areas b ON a.neighbourhood=b.neighbourhood WHERE a.id=? AND b.id=?').bind(user.area_id,game.area_id).first();if(!allowed||owner||game.date<singaporeDate())return json({error:'Cannot join this game'},400);
   const b=await read();if(!deckPreferencesValid(b))return json({error:'Choose whether you need a deck'},400);
   await db.prepare('INSERT INTO requests(id,game_id,user_id,status,deck_need,extra_decks) VALUES(?,?,?,?,?,?) ON CONFLICT(game_id,user_id) DO UPDATE SET deck_need=excluded.deck_need,extra_decks=excluded.extra_decks').bind(crypto.randomUUID(),id,uid,'pending',b.deck_need,b.extra_decks?1:0).run();return json({ok:true});
  }
  if(action==='requests'&&owner){
   if(req.method==='GET')return json({requests:(await db.prepare('SELECT r.id,r.status,r.deck_need,r.extra_decks,u.username FROM requests r JOIN users u ON u.id=r.user_id WHERE game_id=?').bind(id).all()).results});
   if(req.method==='PUT'){const b=await read();if(!['accepted','declined'].includes(b.status))return json({error:'Invalid decision'},400);await db.prepare('UPDATE requests SET status=? WHERE id=? AND game_id=?').bind(b.status,b.id,id).run();return json({ok:true})}
  }
  if(action==='venue'&&owner&&req.method==='PUT'){const b=await read();if(!text(b.details,500))return json({error:'Enter meeting instructions'},400);await db.prepare('UPDATE games SET details=? WHERE id=?').bind(b.details.trim(),id).run();return json({ok:true})}
  if(action==='messages'&&participant){
   if(req.method==='GET')return json({messages:(await db.prepare('SELECT m.body,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE game_id=? ORDER BY m.created_at LIMIT 100').bind(id).all()).results,details:game.details});
   if(req.method==='POST'){const b=await read();if(!text(b.body,500))return json({error:'Message must be 1–500 characters'},400);const recent=await db.prepare('SELECT count(*) n FROM messages WHERE user_id=? AND created_at>?').bind(uid,now()-60).first();if(recent.n>=10)return json({error:'Please wait before sending more messages'},429);await db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,uid,b.body.trim(),now()).run();return json({ok:true})}
  }
  return json({error:'Not allowed'},403);
 }
 if(p==='/api/my-games'&&req.method==='GET')return json({games:(await db.prepare('SELECT g.id,g.title,g.date,g.slot,g.user_id,g.deck_need,g.extra_decks,r.status,r.deck_need AS request_deck_need,r.extra_decks AS request_extra_decks FROM games g LEFT JOIN requests r ON r.game_id=g.id AND r.user_id=? WHERE g.user_id=? OR r.user_id=? ORDER BY g.date DESC LIMIT 50').bind(uid,uid,uid).all()).results});
 if(p==='/api/blocks'&&req.method==='POST'){const b=await read();if(!text(b.user_id,80)||b.user_id===uid)return json({error:'Invalid member'},400);await db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').bind(uid,b.user_id).run();return json({ok:true})}
 if(p==='/api/report'&&req.method==='POST'){const b=await read();if(!text(b.reason,500)||!text(b.game_id,80))return json({error:'Enter a reason'},400);const recent=await db.prepare('SELECT count(*) n FROM reports WHERE user_id=? AND created_at>?').bind(uid,now()-3600).first();if(recent.n>=5)return json({error:'Report limit reached'},429);await db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),uid,b.game_id,b.reason,now()).run();return json({ok:true})}
 if(p==='/api/account'&&req.method==='DELETE'){await db.batch([db.prepare('DELETE FROM games WHERE user_id=?').bind(uid),db.prepare('DELETE FROM users WHERE id=?').bind(uid)]);return json({ok:true},200,{'set-cookie':cookie('rn_session','',0)})}
 return json({error:'Not found'},404);
}
