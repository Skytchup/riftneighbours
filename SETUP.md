# Connect the existing Google login and database

The application already stores accounts, profiles, availability, decks and games in Cloudflare D1. No Supabase migration is needed.

## Production connection

1. Create or select the `riftneighbours` D1 database. Copy its database ID into the `d1_databases` entry shown in `wrangler.jsonc` and uncomment that entry. Keep the binding named `DB` and `migrations_dir` set to `migrations`.
2. Set `APP_ORIGIN` to `https://riftneighbours.coulomb-alexandre.workers.dev` in `wrangler.jsonc`.
3. Create or select a Google OAuth **Web application**. Its authorised redirect URI must be exactly `https://riftneighbours.coulomb-alexandre.workers.dev/auth/callback`. Put the client ID in `GOOGLE_CLIENT_ID` in `wrangler.jsonc`.
4. From this checkout, install dependencies with `npm ci`, then authenticate with `npx wrangler login`.
5. Set the Google client secret using `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Enter it at the hidden prompt; never commit it or paste it into chat.
6. Set invited email addresses using `npx wrangler secret put PILOT_EMAILS`, or add a Secret named `PILOT_EMAILS` in the Worker runtime settings. Use a comma-separated list. Google must return a matching email with `email_verified: true`. Existing `PILOT_GOOGLE_SUBS` entries remain supported. Do not use wildcards.
7. Review both SQL files in `migrations/`, then apply them with `npm run db:remote`.
8. Import reviewed participating locations into `areas` before asking users to complete profiles. The catalogue is currently empty; no fictional demo locations are inserted into production.
9. Deploy the connected configuration through the existing GitHub/Cloudflare pipeline, or `npm run deploy` when working directly with Cloudflare.

## Verify after connection

- `/api/status` returns `{"loginAvailable":true}` when the database binding, Google settings and pilot allowlist are present. This reports configuration presence, not database health or successful Google consent.
- An invited account can sign in and lands on Profile on its first visit.
- Save a username, location, play style, decks and availability. Sign out, sign in again and confirm they persist.
- An uninvited account gets a readable invitation message without an account being created.
- Cancelling Google sign-in returns to the app with a retry message.
- Signing out invalidates that session. Account deletion removes the profile and related contributions.

## Local development

Register `http://localhost:8787/auth/callback` as an additional Google redirect URI. Override `APP_ORIGIN` with `http://localhost:8787` in ignored `.dev.vars`, alongside `GOOGLE_CLIENT_SECRET` and `PILOT_EMAILS`. Use `npm run db:local` to apply migrations to local D1; this does not populate the production database.

Automated tests mock Google's responses and run the real Worker against SQLite. A real Google/D1 sign-in still needs the external setup above.
