// Support the pilot database created manually in the dashboard as well as
// databases initialized through Wrangler migrations. Additive and retry-safe.
const ready=new WeakMap();
const additions={
 users:{available_until:'INTEGER NOT NULL DEFAULT 0',share_map:'INTEGER NOT NULL DEFAULT 0 CHECK(share_map IN (0,1))'},
 areas:{latitude:'REAL',longitude:'REAL',address:"TEXT NOT NULL DEFAULT ''",postal:"TEXT NOT NULL DEFAULT ''",geo_attempted_at:'INTEGER NOT NULL DEFAULT 0'},
 games:{deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 requests:{deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 decks:{legend_id:'TEXT',custom_name:"TEXT NOT NULL DEFAULT ''"}
};
export async function ensureSchema(db){
 if(!ready.has(db)){
  const task=(async()=>{
   await db.prepare('CREATE TABLE IF NOT EXISTS condo_favourites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,area_id))').run();
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
