// Support the pilot database created manually in the dashboard as well as
// databases initialized through Wrangler migrations. Additive and retry-safe.
const ready=new WeakMap();
const additions={
 users:{avatar_legend_id:'TEXT',available_until:'INTEGER NOT NULL DEFAULT 0',share_map:'INTEGER NOT NULL DEFAULT 0 CHECK(share_map IN (0,1))'},
 areas:{latitude:'REAL',longitude:'REAL',address:"TEXT NOT NULL DEFAULT ''",postal:"TEXT NOT NULL DEFAULT ''",geo_attempted_at:'INTEGER NOT NULL DEFAULT 0'},
 games:{start_time:"TEXT NOT NULL DEFAULT ''",is_full:'INTEGER NOT NULL DEFAULT 0 CHECK(is_full IN (0,1))',deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 requests:{deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 decks:{legend_id:'TEXT',custom_name:"TEXT NOT NULL DEFAULT ''"}
};
export async function ensureSchema(db){
 if(!ready.has(db)){
  const task=(async()=>{
   await db.prepare('CREATE TABLE IF NOT EXISTS condo_favourites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,area_id))').run();
   await db.prepare('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,kind TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER)').run();
   await db.prepare('CREATE TABLE IF NOT EXISTS cancellation_notices (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER)').run();
   await db.prepare('CREATE INDEX IF NOT EXISTS cancellation_user ON cancellation_notices(user_id,created_at)').run();
   await db.prepare('CREATE TABLE IF NOT EXISTS game_decks (game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,deck_key TEXT NOT NULL,legend_id TEXT,name TEXT NOT NULL,PRIMARY KEY(game_id,user_id,deck_key))').run();
   await db.prepare('CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at)').run();
   await db.prepare('CREATE TABLE IF NOT EXISTS availability_locations (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,PRIMARY KEY(user_id,area_id))').run();
   await db.prepare(`CREATE TABLE IF NOT EXISTS place_preferences (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,day INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6),slot TEXT NOT NULL CHECK(slot IN ('morning','lunch','afternoon','evening','late')),updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,area_id,day,slot))`).run();
   await db.prepare('CREATE INDEX IF NOT EXISTS place_preferences_area ON place_preferences(area_id,day,slot,updated_at)').run();
   await db.prepare('CREATE VIEW IF NOT EXISTS availability_records AS SELECT user_id,area_id,day,slot,MAX(updated_at) updated_at FROM (SELECT p.user_id,u.area_id,p.day,p.slot,p.updated_at FROM preferences p JOIN users u ON u.id=p.user_id WHERE u.area_id IS NOT NULL UNION ALL SELECT user_id,area_id,day,slot,updated_at FROM place_preferences) GROUP BY user_id,area_id,day,slot').run();
   await db.prepare('CREATE INDEX IF NOT EXISTS users_area ON users(area_id)').run();
   await db.prepare('CREATE INDEX IF NOT EXISTS preferences_fresh ON preferences(user_id,updated_at)').run();
   for(const [table,columns] of Object.entries(additions)){
    const existing=new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c=>c.name));
    for(const [column,definition] of Object.entries(columns))if(!existing.has(column)){
     try{await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()}
     catch(error){
      // Another Worker isolate may have added the same column concurrently.
      const current=(await db.prepare(`PRAGMA table_info(${table})`).all()).results;
      if(!current.some(c=>c.name===column))throw error;
     }
    }
   }
  })().catch(error=>{ready.delete(db);throw error});
  ready.set(db,task);
 }
 return ready.get(db);
}
