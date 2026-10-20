import {oneMap} from './onemap.js';
import {singaporeDate,singaporeDay,singaporeSlot} from './domain.js';
const canonical=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const distanceKm=(a,b)=>{
 const radians=n=>n*Math.PI/180;
 const dlat=radians(b.latitude-a.latitude),dlng=radians(b.longitude-a.longitude);
 const n=Math.sin(dlat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dlng/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(n),Math.sqrt(Math.max(0,1-n)));
};
export async function locateArea(env,id){
 const area=await env.DB.prepare('SELECT * FROM areas WHERE id=?').bind(id).first();
 if(!area||id.startsWith('sg-pa-')||area.latitude!=null&&area.longitude!=null)return area;
 const time=Math.floor(Date.now()/1000);
 if(area.geo_attempted_at>time-3600)return area;
 await env.DB.prepare('UPDATE areas SET geo_attempted_at=? WHERE id=?').bind(time,id).run();
 try{
  const result=(await oneMap(env).search(area.name)).find(r=>canonical(r.name)===canonical(area.name)&&r.latitude!=null&&r.longitude!=null);
  if(result){
   await env.DB.prepare('UPDATE areas SET latitude=?,longitude=?,address=?,postal=? WHERE id=? AND latitude IS NULL').bind(result.latitude,result.longitude,result.address,result.postal,id).run();
   return {...area,...result,id:area.id};
  }
 }catch{/* A provider outage must not break discovery or profile creation. */}
 return area;
}
export async function discover(env,user,{scope='area',radius=5}={}){
 const time=Math.floor(Date.now()/1000),slot=singaporeSlot(),today=singaporeDate();
 const home=await locateArea(env,user.area_id);
 if(!home)return {groups:[],home:null,slot,date:today,radius};
 const ownSchedule=slot&&await env.DB.prepare('SELECT 1 FROM preferences WHERE user_id=? AND day=? AND slot=? AND updated_at>?').bind(user.id,singaporeDay(today),slot,time-86400*60).first();
 const self_status=user.available_until>time?'now':ownSchedule?'usual':null;
 const rows=(await env.DB.prepare(`SELECT u.id,u.available_until,a.id area_id,a.name,a.neighbourhood,a.latitude,a.longitude,a.address,
 EXISTS(SELECT 1 FROM preferences f WHERE f.user_id=u.id AND f.day=? AND f.slot=? AND f.updated_at>?) usual
 FROM users u JOIN areas a ON a.id=u.area_id
 WHERE u.id!=? AND (u.available_until>? OR EXISTS(SELECT 1 FROM preferences f WHERE f.user_id=u.id AND f.day=? AND f.slot=? AND f.updated_at>?))
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=? AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=?))
 ORDER BY a.id,u.id`).bind(singaporeDay(today),slot||'',time-86400*60,user.id,time,singaporeDay(today),slot||'',time-86400*60,user.id,user.id).all()).results;
 const centered=home.latitude!=null&&home.longitude!=null,groups=new Map();let unmapped=0;
 for(const row of rows){
  if(scope==='condo'&&row.area_id!==user.area_id)continue;
  const mapped=row.latitude!=null&&row.longitude!=null;
  const distance=mapped&&centered?distanceKm(home,row):null;
  if(centered&&mapped&&distance>radius)continue;
  if((!centered||!mapped)&&row.neighbourhood!==home.neighbourhood)continue;
  if(!mapped){unmapped++;continue}
  if(!groups.has(row.area_id))groups.set(row.area_id,{id:row.area_id,name:row.name,address:row.address,latitude:row.latitude,longitude:row.longitude,distance:distance==null?null:Math.round(distance*10)/10,ready_count:0,usual_count:0,total_count:0});
  const group=groups.get(row.area_id);group.total_count++;if(row.available_until>time)group.ready_count++;if(row.usual)group.usual_count++;
 }
 return {groups:[...groups.values()].sort((a,b)=>(a.distance??0)-(b.distance??0)),home:{name:home.name,latitude:home.latitude,longitude:home.longitude},self_status,self_usual:Boolean(ownSchedule),slot,date:today,radius,unmapped};
}
