-- Deck logistics belong to each game, not a permanent lending preference.
-- Existing games/requests default to bringing a personal deck.
ALTER TABLE games ADD COLUMN deck_need TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'));
ALTER TABLE games ADD COLUMN extra_decks INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1));
ALTER TABLE requests ADD COLUMN deck_need TEXT NOT NULL DEFAULT 'own' CHECK(deck_need IN ('own','need'));
ALTER TABLE requests ADD COLUMN extra_decks INTEGER NOT NULL DEFAULT 0 CHECK(extra_decks IN (0,1));
-- decks.lend is retained for backwards compatibility but is no longer read/used.
