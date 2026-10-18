# RiftNeighbours

**Your next game is closer than you think.** A Singapore neighbourhood community for casual Riftbound. Find overlapping availability first; agree a venue together.
## This first implementation

- Responsive cream/teal/coral interface, without a frontend build dependency.
- Explicit demo mode: fictional aggregate counts and a sample invitation, browser-only state, no messages sent.
- Weekly availability grid (Singapore time), independently confirmed daily availability, opt-in condo grouping.
- Anonymous aggregate nearby counts; small counts banded to `1–2`; no public member directory.
- Venue-optional game suggestions, requests and organiser acceptance.
- Accepted-player discussion and private meeting instructions.
- Profile, loan-deck preferences, account deletion, reports and member-blocking backend.
- Cloudflare Worker + D1, Google OAuth, opaque hashed sessions and same-origin writes.

The live service fails closed if infrastructure/authentication is absent. This is a foundation for an **invite-only adult pilot**, not a finished public service. Condo locations are self-declared, never labelled verified. A small group/count band does not guarantee anonymity against inference.

## Local preview

Use Node 24 (tests use its built-in SQLite) and npm.

```sh
npm ci
npm run dev
```

Open the displayed local URL and choose **Explore the demo**. No D1 or Google setup is required for demo mode. To test static screens only, `python3 -m http.server 8787 --directory public` also works. Google fonts are optional; system fallbacks work offline.

## Connect Cloudflare and D1

```sh
npx wrangler login
npx wrangler d1 create riftneighbours
```

Add the returned database ID to `wrangler.jsonc`:

```json
"d1_databases": [{
  "binding": "DB",
  "database_name": "riftneighbours",
  "database_id": "YOUR_DATABASE_ID",
  "migrations_dir": "migrations"
}]
```

```sh
npm run db:local
# Apply to the remote database only after inspecting migrations:
npm run db:remote
```

No real condos are seeded automatically. Add the participating locations after recruiting a pilot group. For example, using your actual agreed group names:

```sql
INSERT INTO areas(id,name,neighbourhood) VALUES ('pilot-a','Participating estate','Pilot neighbourhood');
```

Use `npx wrangler d1 execute riftneighbours --local --command "..."` for local data; `--remote` for production. Separate remote test and production D1 databases before recruiting real users.

## Google login

1. Create a Google OAuth web application.
2. Register `https://YOUR_HOST/auth/callback` as an authorised redirect URI (and `http://localhost:8787/auth/callback` for development).
3. Set `APP_ORIGIN` to the exact origin, with no trailing slash, and `GOOGLE_CLIENT_ID` in `wrangler.jsonc`.
4. Set secrets:

```sh
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PILOT_EMAILS
```

`PILOT_EMAILS` is a comma-separated list of invited email addresses, configured as a Worker secret. Login requires a matching email returned by Google with `email_verified: true`. Addresses are compared case-insensitively. The existing `PILOT_GOOGLE_SUBS` allowlist remains supported. Without either allowlist, login admits nobody. Accounts remain keyed by Google subject; email is used for admission and is not stored in user profiles.

For local auth, put the two secrets in ignored `.dev.vars`. Keep credentials out of git. The app requests `openid email` for invitation checks; it does not request a name or photo. OAuth uses a short-lived state cookie; app sessions expire after 14 days. HTTPS is required outside localhost.

```sh
npm run deploy
```

A custom domain is optional. Workers' assigned domain can be used for the pilot, provided the OAuth redirect matches it. This repository does not provision cloud resources or deploy itself automatically.

## Model and privacy boundaries

`users → preferences / confirmations / decks`; `areas → games → requests / messages`.

- Sunday = 0. Slots: afternoon 14:00–18:00, evening 18:00–21:00, late 21:00–00:00, Asia/Singapore.
- Preferences older than 60 days stop contributing until saved again.
- Confirmations stop counting on the next Singapore date, independently of preferences.
- Discovery excludes self and mutually blocked members.
- Neighbourhood membership is required for join requests. Condo counts additionally require opt-in.
- Game discovery excludes usernames and meeting instructions; request usernames are disclosed to the organiser. Accepted discussion contains participant usernames.
- Declined/pending applicants cannot read messages or exact meeting instructions.
- Expired sessions and past confirmations are removed by a daily 00:05 SGT scheduled task.
- Deleting an account removes its games and related contributions; reports retain the submitted reason with reporter identity detached. Final moderation retention policy must be settled before public launch.
- Public sample counts never enter live D1.

## Verification

```sh
npm test
npm run check
```

The tests run the actual Worker routes with a SQLite-backed D1 adapter. They cover SGT expiry, authentication/CSRF boundaries, low-count bands, atomic preferences, venue privacy, request permissions, blocking and deletion cascades. They do not replace a deployed OAuth/D1 integration test.

## Still required before wider release

- Actual OAuth, D1, domain configuration, real-device sign-in and production smoke tests.
- Proper invitations and onboarding instead of manually managing OpenID subjects.
- Moderator dashboard and monitored report notifications; reports currently persist in D1 for operator review.
- Email/push notifications: currently users refresh/open My games to check responses. No claim that offline neighbours have been notified.
- Final privacy notice/contact, retention policy, hosting/subprocessor review and community terms.
- Global edge rate limiting/Turnstile and operational monitoring. Route limits exist for suggestions, messages and reports; they are not a complete abuse defence.
- Backups and restore rehearsal, production alerts and budget monitoring.
- Game cancellation/capacity controls, optional deck-request details, accessible user-facing block management and notification preferences.

The priority is observing real games arranged and repeat participation, rather than maximising profile counts. Brand/name clearance and Riot fan-project requirements should be reviewed before public promotion.

## October 17: compact interface and per-game decks

The Nearby screen now opens on availability, without a marketing hero. Official Riftbound logo/art references are from playriftbound.com (Riot CDN); the fan-project attribution remains. External image availability depends on the publisher. No affiliation is implied.

Deck lists are names only. On suggesting/joining a game, choose `own` or `need` and optionally offer extra decks. Organisers see these choices in requests. A deck request is not a guaranteed loan. Apply migration `0002_game_deck_preferences.sql` before running this version against live D1. The old `decks.lend` column is retained but unused.

### URA-backed searchable location catalogue

The profile uses an autocomplete input backed by the `areas` table. Import official project names once and refresh periodically rather than calling URA from each user's browser.

URA requires registration and an access key: https://eservice.ura.gov.sg/maps/api/
The rental-search page excludes developments without rental contracts in the last 60 months; the median API also has rental-count coverage thresholds. Neither is an exhaustive condo register. Imported projects are grouped by **postal district**, a coarse grouping, not a claim that every project is within walking distance. Keep curated HDB/estate entries alongside imported private projects. Review URA's API terms and display appropriate attribution when publishing imported data.

```sh
# Set URA_ACCESS_KEY in your local environment, never in frontend code or git.
node scripts/import-ura-areas.mjs --output ura-areas.sql
# Or use a downloaded official data-service JSON response (array of responses accepted):
node scripts/import-ura-areas.mjs --input ura-export.json --output ura-areas.sql
# Review the generated project list, then import into your configured database:
npx wrangler d1 execute riftneighbours --remote --file ura-areas.sql
```

This adds/updates stable project IDs; it never removes existing locations or reassigns users. Only project name, street-derived stable ID and district grouping are used, not prices, tenants or unit addresses. No catalogue has been fetched/imported without the operator's URA key. The demo still uses clearly fictional locations.

## Location onboarding

Profile setup always offers Singapore's 55 planning areas from SLA OneMap planning-area names (https://www.onemap.gov.sg/apidocs/planningarea). A neighbourhood-only profile can be saved without seeding D1. Members may optionally add a self-declared condo or estate name within a planning area; normalized names reuse stable IDs within that area. Condo sharing requires a condo, while neighbourhood-only profiles contribute to neighbourhood counts. Planning areas are coarse groups, not distance matching. The stored catalogue is not an exhaustive condo register. OneMap building search is available to signed-in members when `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` are configured as Worker runtime secrets. Existing URA/curated locations remain available. No database migration is needed for this onboarding change.

## OneMap building search

Set `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` as encrypted runtime secrets on the existing Worker. No schema migration is required. Select a planning area in Profile, search a building name or postal code, select a result and save. OneMap provides address matches, not residency verification or a condo-only exhaustive catalogue. Planning area remains selected by the member. The selected building name is revalidated on the server before saving; account data remains tied to Google login. Names reuse the existing planning-area/name IDs so manual entries with the same normalized name are preserved. Different blocks of the same named development in one planning area are grouped together. OneMap building coordinates and the public building address are saved for condo-level discovery. No unit address or device location is collected.

Provider access tokens are kept only in Worker memory, renewed before expiry and retried once after 401/403. Search results are cached for five minutes, with a maximum of 50 queries per isolate. A cold start reauthenticates on demand. The authenticated search/save routes share a per-isolate limit of 30 lookups per member per minute, not a global edge rate limit. Provider secrets, tokens and raw upstream errors are never sent to the browser. The profile retains manual entry and neighbourhood-only saving if search is unavailable. Queries are sent server-side to OneMap; attribution links to SLA OneMap are shown beside results.

## Legend decks and manual-schema compatibility

Profile and decks are now saved in one D1 transaction. A deck selects a Legend from the official Riot gallery snapshot in `public/legends.js` (2026-10-19, 58 distinct Legends, alternate printings combined). Names are optional and default to champion plus Legend title. Custom names are limited to 60 characters. Existing named decks are preserved; recognizable unique champion names are preselected in the picker. Card images remain hosted by Riot; set labels distinguish entries, including revealed cards in the gallery.

The authenticated Worker checks required additive columns once per database object/isolate, adding only missing game/request deck preferences and `decks.legend_id` / `decks.custom_name`. This bridges the dashboard-created pilot database, where migration 0002 may not have run. Existing records remain intact. For a fresh database, migrations 0001–0003 initialize the same schema. Do not manually re-run raw ALTER statements after the runtime bridge already added those columns; inspect table_info and reconcile migration history first. Automated tests cover the initial-only schema, transaction rollback, named/unnamed Legend decks, and the Nearby routes after saving.

## Nearby map and Available Now

Nearby is now map-first, using bundled Leaflet 1.9.4 and the official OneMap basemap with attribution. Map sharing is a separate, default-off `users.share_map` consent: it discloses username, condo address and current status to signed-in nearby members. Existing aggregate-count consent does not opt anyone in. Markers group opted-in players at their condo. Teal means explicit Available Now, which expires after two hours; amber means a saved schedule matches the current Singapore day/time slot (afternoon 14–18, evening 18–21, late 21–24). Explicit availability takes precedence. No schedule matches before 14:00. Stale schedules older than 60 days and blocked/self accounts are excluded from other-player results. Full weekly timetables are never returned by map discovery.

OneMap selections persist building latitude, longitude and public address; earlier condo names are geocoded on their owner's next map visit using an exact normalized building-name match. Failed lookups retry after one hour; reselecting a OneMap result in Profile can supply coordinates immediately. Missing coordinates are never fabricated. Discovery uses 2/5/10/20 km radii around the member's condo when known, otherwise the selected neighbourhood. Condo scope restricts to the same area ID. The endpoint is bounded to 500 active/usually available opted-in candidates per request. Availability and data refresh once a minute while the Nearby page is visible and no dialog is open. The player list remains usable if the map library fails.

Migration 0004 and the idempotent authenticated runtime schema bridge add presence, sharing and building-location fields. No existing profile is deleted. New profiles may remain neighbourhood-only, but map sharing requires a condo. The old tonight-confirmation API remains compatible for older clients; it does not mark players Available Now. Tests cover opt-in, blocking, two-hour expiry, current-slot schedule matching, distance, missing coordinates, and geometry persistence.

## Condo / estate view

The condo tab is separate from the neighbourhood map. Search combines registered condos and official OneMap building results. Opening an external result validates it server-side, resolves its planning area, and reuses the same stable area ID as profile onboarding. Selecting or favouriting a condo never changes the member's home profile. Search still covers buildings of all types; the application does not claim an exhaustive condo-only register. Favourites are stored privately per account in `condo_favourites`; the current home condo is included automatically.

Selecting a condo returns an anonymous 7-day × 3-slot timetable of exact aggregate counts. Only members who opted into condo aggregate counts contribute to this full weekly grid; map-only consent does not disclose weekly patterns. Counts include the viewer when opted in, exclude mutually blocked accounts, and ignore schedules older than 60 days. No usernames, user IDs or individual timetable rows are returned by the condo endpoints.

Nearby recommendations consider registered condos with shared availability and known coordinates, prefilter within 1.5 km, route up to 12 candidates using OneMap walking routes, and show up to six within 15 minutes. Available Now counts rank first; the fallback order is the number of distinct neighbours with any fresh usual availability, then walk duration. Active counts use map or condo aggregate consent. Failed routing uses a labelled approximation (straight-line distance × 1.3 detour at 80 m/min), still applying the 15-minute threshold. Routing results cache for one hour; failures cache for five minutes. No nearby recommendation is invented for unknown coordinates. Migration 0005 and the runtime schema bridge initialize favourites.
