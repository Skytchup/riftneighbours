import {distanceKm,locateArea} from './discovery.js';
import {oneMap,LocationError} from './onemap.js';
import {planningAreas} from './areas.js';
import {singaporeDate,singaporeDay,singaporeSlot,SLOTS} from './domain.js';
const canonical=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const publicArea=a=>({id:a.id,name:a.name,address:a.address||'',neighbourhood:a.neighbourhood});
const visible=`NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))`;
export async function condoStats(db,uid){
 const time=Math.floor(Date.now()/1000),day=singaporeDay(singaporeDate()),slot=singaporeSlot()||'';
 return (await db.prepare(`SELECT a.*,
 SUM(CASE WHEN u.area_id=a.id AND u.available_until>? THEN 1 ELSE 0 END) available_now,
 SUM(CASE WHEN EXISTS(SELECT 1 FROM availability_records p WHERE p.user_id=u.id AND p.area_id=a.id AND p.updated_at>?) THEN 1 ELSE 0 END) usual_people,
 SUM(CASE WHEN EXISTS(SELECT 1 FROM availability_records p WHERE p.user_id=u.id AND p.area_id=a.id AND p.day=? AND p.slot=? AND p.updated_at>?) THEN 1 ELSE 0 END) usual_now
 FROM areas a LEFT JOIN users u ON (u.area_id=a.id OR EXISTS(SELECT 1 FROM availability_records f WHERE f.user_id=u.id AND f.area_id=a.id AND f.updated_at>${time-86400*60})) AND ${visible}
 WHERE a.id NOT LIKE 'sg-pa-%' GROUP BY a.id`).bind(time,time-86400*60,day,slot,time-86400*60,uid,uid).all()).results;
}
export async function condoOverview(env,user){
 const home=user.area_id&&!user.area_id.startsWith('sg-pa-')?await env.DB.prepare('SELECT * FROM areas WHERE id=?').bind(user.area_id).first():null;
 const rows=await condoStats(env.DB,user.id);
 const favourites=(await env.DB.prepare('SELECT area_id FROM condo_favourites WHERE user_id=? ORDER BY created_at,area_id').bind(user.id).all()).results.map(r=>r.area_id);
 if(home&&!favourites.includes(home.id))favourites.unshift(home.id);
 const summary=a=>({...publicArea(a),available_now:Number(a.available_now||0),usual_people:Number(a.usual_people||0),usual_now:Number(a.usual_now||0),is_home:a.id===home?.id});
 let nearby=[];
 if(home?.latitude!=null&&home?.longitude!=null){
  const candidates=rows.filter(a=>a.id!==home.id&&a.latitude!=null&&a.longitude!=null&&(a.available_now>0||a.usual_people>0)).map(a=>({...a,distance:distanceKm(home,a)})).filter(a=>a.distance<=1.5)
   .sort((a,b)=>b.available_now-a.available_now||b.usual_people-a.usual_people||a.distance-b.distance).slice(0,12);
  nearby=candidates.map(area=>{
   const walk={minutes:Math.max(1,Math.ceil(area.distance*1000*1.3/80)),estimated:true};
   return {...summary(area),walk};
  }).filter(a=>a.walk.minutes<=15)
   .sort((a,b)=>b.available_now-a.available_now||b.usual_people-a.usual_people||a.walk.minutes-b.walk.minutes).slice(0,6);
 }
 return {home:home?publicArea(home):null,favourites:favourites.map(id=>rows.find(a=>a.id===id)).filter(Boolean).map(summary),nearby,can_walk:Boolean(home?.latitude!=null&&home?.longitude!=null)};
}
export async function condoSchedule(db,user,id){
 const area=await db.prepare('SELECT * FROM areas WHERE id=?').bind(id).first();
 if(!area||id.startsWith('sg-pa-'))return null;
 const time=Math.floor(Date.now()/1000);
 const rows=(await db.prepare(`SELECT p.day,p.slot,COUNT(DISTINCT p.user_id) people FROM availability_records p JOIN users u ON u.id=p.user_id
 WHERE p.area_id=? AND p.updated_at>? AND ${visible} GROUP BY p.day,p.slot`).bind(id,time-86400*60,user.id,user.id).all()).results;
 return {area:publicArea(area),cells:SLOTS.flatMap(slot=>Array.from({length:7},(_,day)=>({day,slot,count:Number(rows.find(r=>r.day===day&&r.slot===slot)?.people||0)})))};
}
export async function condoSearch(env,query){
 const rows=(await env.DB.prepare("SELECT * FROM areas WHERE id NOT LIKE 'sg-pa-%' AND (name LIKE ? ESCAPE '\\' OR postal=?) ORDER BY name LIMIT 20").bind('%'+query.replace(/[\\%_]/g,'\\$&')+'%',query).all()).results;
 let external=[],message='';
 try{external=await oneMap(env).search(query)}catch{message='OneMap search is unavailable. Showing saved places only.'}
 const results=rows.map(a=>({...publicArea(a),saved:true}));
 for(const item of external){if(results.some(a=>canonical(a.name)===canonical(item.name)))continue;results.push({id:item.id,name:item.name,address:item.address,saved:false,query})}
 return {results:results.slice(0,30),message};
}
export async function registerCondo(env,choice){
 const found=(await oneMap(env).search(choice.query)).find(a=>a.id===choice.id);
 if(!found||found.latitude==null||found.longitude==null)throw new LocationError('Search and select a place with a map location.');
 const existing=(await env.DB.prepare("SELECT * FROM areas WHERE id NOT LIKE 'sg-pa-%'").all()).results.find(a=>canonical(a.name)===canonical(found.name)&&((a.latitude==null)||distanceKm(a,found)<0.6));
 if(existing){await locateArea(env,existing.id);return publicArea(existing)}
 const planningName=await oneMap(env).planningArea(found),planning=planningAreas.find(a=>canonical(a.name)===canonical(planningName||''));
 if(!planning)throw new LocationError('OneMap could not identify the neighbourhood. Please try another building result.');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(planning.id+'|'+canonical(found.name)));
 const id='sg-condo-'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
 await env.DB.prepare('INSERT OR IGNORE INTO areas(id,name,neighbourhood,latitude,longitude,address,postal) VALUES(?,?,?,?,?,?,?)').bind(id,found.name,planning.name,found.latitude,found.longitude,found.address,found.postal).run();
 return publicArea({...found,id,neighbourhood:planning.name});
}
