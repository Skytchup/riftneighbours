export async function selectedDecks(db,uid,ids){
 if(ids===undefined)return [];
 if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>80))return null;
 const owned=(await db.prepare('SELECT id,name,legend_id FROM decks WHERE user_id=?').bind(uid).all()).results;
 const chosen=ids.map(id=>owned.find(d=>d.id===id));return chosen.some(d=>!d)?null:chosen;
}
export function saveLobbyDecks(db,game,uid,decks){return [db.prepare('DELETE FROM game_decks WHERE game_id=? AND user_id=?').bind(game,uid),...decks.map(d=>db.prepare('INSERT INTO game_decks(game_id,user_id,deck_key,legend_id,name) VALUES(?,?,?,?,?)').bind(game,uid,d.id,d.legend_id,d.name))]}
export async function enrichGames(db,uid,rows){
 if(!rows.length)return rows;
 const ids=rows.map(g=>g.id),placeholders=ids.map(()=>'?').join(',');
 const [locations,notes]=await Promise.all([
  db.prepare(`SELECT g.id,g.details FROM games g WHERE g.id IN (${placeholders}) AND (g.user_id=? OR EXISTS(SELECT 1 FROM requests r WHERE r.game_id=g.id AND r.user_id=? AND r.status='accepted'))`).bind(...ids,uid,uid).all(),
  db.prepare(`SELECT game_id,kind,count(*) n FROM notifications WHERE user_id=? AND read_at IS NULL AND game_id IN (${placeholders}) GROUP BY game_id,kind`).bind(uid,...ids).all()
 ]);
 return rows.map(g=>{const unread=notes.results.filter(n=>n.game_id===g.id);return {...g,details:locations.results.find(l=>l.id===g.id)?.details||'',unread:unread.reduce((n,x)=>n+x.n,0),unread_venue:unread.some(n=>n.kind==='venue'),unread_chat:unread.some(n=>n.kind==='message'),unread_decks:unread.some(n=>n.kind==='decks')}});
}
export const timeSlot=time=>Number(time.slice(0,2))>=21?'late':Number(time.slice(0,2))>=18?'evening':'afternoon';
export const validTime=time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
