PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, username TEXT NOT NULL, area_id TEXT, style TEXT NOT NULL DEFAULT 'casual', share_condo INTEGER NOT NULL DEFAULT 0 CHECK(share_condo IN (0,1)), created_at INTEGER NOT NULL);
CREATE TABLE areas (id TEXT PRIMARY KEY, name TEXT NOT NULL, neighbourhood TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE preferences (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6), slot TEXT NOT NULL CHECK(slot IN ('afternoon','evening','late')), updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,day,slot));
CREATE TABLE confirmations (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, slot TEXT NOT NULL CHECK(slot IN ('afternoon','evening','late')), PRIMARY KEY(user_id,date,slot));
CREATE TABLE decks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, lend INTEGER NOT NULL DEFAULT 0 CHECK(lend IN (0,1)));
CREATE TABLE games (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, area_id TEXT NOT NULL REFERENCES areas(id), title TEXT NOT NULL, date TEXT NOT NULL, slot TEXT NOT NULL, venue TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE requests (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')), UNIQUE(game_id,user_id));
CREATE TABLE messages (id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE blocks (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(user_id,blocked_id));
CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, game_id TEXT, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX games_area_date ON games(area_id,date);
CREATE INDEX confirmations_date ON confirmations(date,slot);
CREATE INDEX messages_game ON messages(game_id,created_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Deck logistics belong to each game, not a permanent lending preference.
-- Existing games/requests default to bringing a personal deck.
ALTER TABLE games ADD COLUMN deck_need TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'));
ALTER TABLE games ADD COLUMN extra_decks INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1));
ALTER TABLE requests ADD COLUMN deck_need TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'));
ALTER TABLE requests ADD COLUMN extra_decks INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1));
-- decks.lend is retained for backwards compatibility but is no longer read/used.

