# MestriCentring.com — Google Sheets Backend (v1.0)

Zero-cost backend for the static GitHub Pages frontend: **Google Sheets = database,
Apps Script = REST-ish API, JSONP/no-cors = transport, GitHub Pages = hosting.**

## Architecture
```
Browser (GitHub Pages)
   │  JSONP GET  ────────────┐   reads: rates, mestris, suppliers, projects, demand
   │  no-cors POST ──────────┤   writes: estimate logs, contact msgs, projects, quotes
   ▼                         │
Google Apps Script Web App    │
   │  LockService (concurrency)│
   ▼                         │
Google Sheet "MC_PRODUCTION"  │  14 tabs = relational schema
```

## Read path (CORS-proof)
Apps Script sends no `Access-Control-Allow-Origin`, so `fetch()` reads fail cross-origin.
`db.js` uses **JSONP** (`?callback=cb`) — `<script src>` is not CORS-restricted.
Single bootstrap call `getBootstrap` returns rates + zones + project types + steel defaults
in one round trip (~1-2 s); frontend renders instantly with embedded fallback rates,
then upgrades silently when the sheet responds.

## Write path
`fetch(POST, mode:'no-cors', Content-Type:text/plain)` → Apps Script `doPost`.
Response is unreadable cross-origin by design — writes are fire-and-forget.
`LockService` serializes concurrent writes; every write gets a UUID id + ISO timestamp.

## Tabs (14)
| Tab | Grain | Key | Written by |
|---|---|---|---|
| CONFIG | key/value site settings | key | admin |
| ZONE_MASTER | 4 zone multipliers | zone_code | admin |
| PROJECT_TYPES | 3 project-type multipliers | type_code | admin |
| RATE_MASTER | 15 centring rate cards | item_code | admin |
| STEEL_DEFAULTS | default calculator inputs | key | admin |
| MESTRIS | contractor profiles | mestri_id | API+admin |
| SUPPLIERS | supplier companies | supplier_id | admin |
| SUPPLIER_INVENTORY | rentable stock per supplier | item_id | supplier/admin |
| BUILDERS | developer accounts | builder_id | admin |
| PROJECTS | job postings from builders | project_id | API+admin |
| QUOTES | mestri bids on projects | quote_id | API |
| ESTIMATE_LOG | every calculator run | log_id | API |
| CONTACT_MESSAGES | form + quick-query inbox | msg_id | API |
| HIRE_DEMAND | weekly market rent snapshot | item | admin |

## Relationships
```
MESTRIS 1─∞ QUOTES ∞─1 PROJECTS ∞─1 BUILDERS
SUPPLIERS 1─∞ SUPPLIER_INVENTORY
PROJECTS / QUOTES / MESTRIS reference ZONE_MASTER by zone_code
```

## Setup (15 min)
1. Create Google Sheet → Extensions → Apps Script → paste `Code.gs` → set `SHEET_ID` + `API_TOKEN`.
2. Run `setupTabs()` once (grants permissions).
3. Import `sheet-templates/*.csv` into matching tabs (File → Import).
4. Deploy → Web app → execute as Me → access: **Anyone** → copy `/exec` URL.
5. Paste URL + token into `db.js`, commit to repo with `index.html` + `db.js`.
6. In `index.html`, swap the `DOMContentLoaded` block per the usage note in `db.js`.

## Security notes (MVP level)
- API_TOKEN is obfuscation only — it ships in client JS. Fine for lead capture,
  NOT fine for PII or money. Mitigations: separate write sheets, weekly purge,
  Cloudflare Turnstile on forms, or graduate to Firebase/Supabase at scale.
- Validate/ sanitize all strings server-side before they reach sheets.
- Keep the sheet private; only the web app is public.

## Scaling exit ramps
< 10k req/day → this setup. Beyond → move RATE_MASTER to a cached JSON in the repo
(hourly GitHub Action dumps sheet → commits `rates.json` → zero-latency static reads),
then Supabase when writes get relational.
