import {legends} from '../public/legends.js';
export function prepareDecks(items){
 if(!Array.isArray(items)||items.length>12)return null;
 const normalized=[];
 for(const item of items){
  if(!item||typeof item!=='object')return null;
  if(item.legend_id){
   const legend=legends.find(l=>l.id===item.legend_id);
   const custom=item.custom_name??'';
   if(!legend||typeof custom!=='string'||custom.trim().length>60)return null;
   normalized.push({legend_id:legend.id,custom_name:custom.trim(),name:custom.trim()||`${legend.champion} · ${legend.title}`});
  }else{
   // Keep old named decks editable during rollout; new UI requires a Legend.
   if(typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>60)return null;
   normalized.push({legend_id:null,custom_name:'',name:item.name.trim()});
  }
 }
 return normalized;
}
export function deckStatements(db,uid,decks){
 return [db.prepare('DELETE FROM decks WHERE user_id=?').bind(uid),...decks.map(d=>db.prepare('INSERT INTO decks(id,user_id,name,lend,legend_id,custom_name) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,d.name,0,d.legend_id,d.custom_name))];
}
