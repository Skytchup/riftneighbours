// Support the pilot database created manually in the dashboard as well as
// databases initialized through Wrangler migrations. Additive and retry-safe.
const ready=new WeakMap();
const additions={
 games:{deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 requests:{deck_need:"TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'))",extra_decks:'INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1))'},
 decks:{legend_id:'TEXT',custom_name:"TEXT NOT NULL DEFAULT ''"}
};
export async function ensureSchema(db){
 if(!ready.has(db)){
  const task=(async()=>{
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
