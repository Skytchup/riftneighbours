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
npx wrangler secret put PILOT_GOOGLE_SUBS
```

`PILOT_GOOGLE_SUBS` is a comma-separated allowlist of the invited users' Google OpenID subject identifiers. Obtain these through a controlled onboarding process; never accept a subject supplied as proof of identity. Without an allowlist, Google login does not admit anyone. This keeps the unfinished pilot closed. Replace with a proper invitation flow before scaling.

For local auth, put the two secrets in ignored `.dev.vars`. Keep credentials out of git. The app requests only `openid`; it does not need a member's Google name, photo or email. OAuth uses a short-lived state cookie; app sessions expire after 14 days. HTTPS is required outside localhost.

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
