# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A React SPA on GitHub Pages that reads and writes a Google Sheet. No server.
Design and phase history: [plan.md](./plan.md). User-facing setup, the access
runbook and troubleshooting: [README.md](./README.md).

It tracks two entities: a **feature** belongs to a channel and a release; an
**action** is something that has to happen about a feature. Actions reference
their feature by UUID. Channels, releases, owners, action types and every status
are **data in the `Lists` tab**, read at runtime — not options in the code.

**The `Actions` tab holds the whole timeline, not just this team's workload.**
An action's `actor` says who performs it; anything other than `architecture` is
context — a delivery milestone, a vendor deliverable. That is what "events" are
here: there is no separate Events entity, an event is an action with a
non-architecture actor.

Consequently **every rollup must filter through `isOwnedAction`**
(`src/lib/rollups.ts`). A feature's Open Actions column and the dashboard's
open/overdue figures answer "what do *we* owe", and counting somebody else's
milestone makes them answer nothing in particular. A blank actor counts as
ours: the field was added after the fact, and defaulting blanks out would zero
every rollup at once.

**Which actors count as ours is data too.** `ownedActorIds` reads `actor` rows
in `Lists` whose `parent` is `ours`, so splitting the architecture function is a
sheet edit rather than a deploy. `parent` normally scopes a value to another
list; on `actor` rows nothing scopes them, so the column is reused — that is the
one place it means something else. When **no** row is marked it falls back to
`ARCHITECTURE_ACTOR`, and that fallback is load-bearing: an empty set would mean
"nobody's work is ours", every count would read zero, and zero outstanding work
looks like good news rather than a broken config. `isOwnedAction` takes the set
as a **required** argument for the same reason — an optional one would let a new
call site be accidentally right today and wrong later.

## Commands

```bash
npm run dev                     # port 5173 — PINNED, it is a registered OAuth origin
npm run build                   # typecheck + tests + vite build
npm test                        # vitest run
npm test -- rows                # one test file (substring match on the path)
npm run test:watch              # vitest in watch mode
npm run typecheck               # tsc --noEmit alone
```

Deploy is `git push origin main` — GitHub Actions builds and publishes. Tests
run inside `npm run build`, so a red test blocks the deploy.

## The rule that matters most

**Never put a secret in this repo.** Everything here ships inside the JS bundle
that GitHub Pages serves publicly. `VITE_SPREADSHEET_ID`,
`VITE_GOOGLE_CLIENT_ID` and `VITE_GCP_PROJECT_ID` are committed on purpose — all
three are public identifiers that grant nothing on their own. A service-account
key, client secret, or write-scoped API key would be world-readable.

## Architecture facts that are easy to get wrong

- **The UI is not a security boundary.** The browser calls the Sheets API
  directly with the user's own token, so any user can bypass the app entirely.
  Roles are enforced by Drive sharing level (a `viewer` is shared as Drive
  Viewer) and by protected ranges. `src/lib/permissions.ts` only decides what to
  render.
- **Row numbers are never identity.** Sorting the sheet moves every row. Each
  write re-reads the sheet and resolves the row from the record's UUID
  immediately beforehand. Never cache a row index across a user interaction.
  This holds even though the app already has a cached snapshot: writes take
  their own fresh read, and that cost is deliberate.
- **Never put a formula in an entity tab.** `writeRow` PUTs the whole row from
  column A to the last mapped column, so any formula in that span is wiped the
  first time someone edits that row. The workbook's `#` and `Open Actions`
  columns were formulas; both are computed in the client now. Derived values
  live in `src/lib/rollups.ts` and are passed to `EntityTable` as
  `derived` columns — deliberately *not* `entity.fields`, because
  `recordToRow` only iterates `entity.fields`, which makes a derived column
  structurally incapable of reaching the sheet.
- **`reference` and `link` warn, they never reject.** Unlike `select`,
  `validateField` accepts a value it does not recognise. The vocabulary is
  editable data outside the app's control: if an admin retires a release,
  rejecting would stop an editor changing the *owner* on any feature that
  carries it. Unrecognised values render with `chip--unknown`; retired ones
  render normally, which is why `lists.ts` keeps `active` and `known` apart.
- **`USER_ENTERED` makes a leading `=` a live formula.** All text written to the
  sheet goes through `sanitizeText()`. `=IMAGE(...)` is a data-exfiltration
  path, not a display bug.
- **Dates are Google serial numbers**, not ISO strings — days since 1899-12-30,
  converted in `src/sheets/rows.ts` and nowhere else. The conversion is UTC-only;
  using local time shifts dates across midnight by timezone.
- **`base: '/tracker/'`** in `vite.config.ts` must match the repo name. A wrong
  value produces a white page with 404s on every asset.
- **`HashRouter`**, because Pages has no rewrite rules and would 404 on a hard
  refresh of a deep link. Consequence: an `href="#some-id"` anchor is read as a
  route change and navigates away. Scroll with `scrollIntoView` instead.
- **`--mark` and `--live` are a validated pair, not two colours.** They are the
  CIB brand blue and orange, and the dashboard uses them to separate *progress*
  from *attention*. Both are checked per mode for colour-blind separation, the
  mode's OKLCH lightness band and ≥3:1 against that mode's surface — which is
  why neither is the literal brand hex in every slot (the promo orange is
  2.72:1 on white). Changing one means re-running the check on **both**, in
  **both** modes; a token edited alone is how a palette quietly stops being
  readable. `--brand`, `--brand-deep` and `--brand-orange` hold the untouched
  brand values everything else derives from.
- **The app bar redefines `--fg`, `--muted`, `--accent` and `--line`** inside
  its own rule so its children invert onto navy without a selector each. Add a
  child that reads those tokens and it is themed already; hardcode a colour
  there and it will be wrong in one of the two modes.

## Auth and session

- The access token lives in **module memory only** — never `localStorage`, never
  `sessionStorage`. `src/auth/rememberedUser.ts` puts the email and display name
  in `sessionStorage` so a reload can offer one-click resume; that is the only
  thing that is ever persisted.
- **A silent token refresh still opens a popup.** GIS `requestAccessToken({
  prompt: '' })` needs a user gesture, so browsers block it on page load. That is
  why reload shows a "Continue as <you>" button rather than restoring by itself,
  and why refresh-on-401 mid-session works fine — a click preceded it.
- **A 403 from Sheets means three different things** — API not enabled, scope not
  granted, or not shared on the sheet. `SheetsError.forbiddenKind` disambiguates
  by matching Google's message; each maps to a different remedy, so never
  collapse them back into one "ask an admin to share it".
- **Retry is deliberately asymmetric** in `src/sheets/client.ts`: 429 is always
  retried, 5xx only for GET. A 5xx on an `:append` may have written the row, and
  a blind retry creates a duplicate record.

## Config

`src/config/env.ts` reads `import.meta.env.VITE_X` one static property at a
time. Vite substitutes those by **literal text replacement** at build time — a
dynamic lookup like `import.meta.env[key]` works in dev and silently returns
`undefined` in the production bundle. Do not refactor that into a loop.

## Layout

```
src/auth/      GIS token lifecycle, session state machine
src/sheets/    the ONLY place that knows about the Sheets API
               collection.ts  entity-parameterized CRUD
               lists.ts       the Lists tab (runtime vocabularies)
               snapshot.ts    loadAppData — every tab in ONE batchGet
src/data/      TrackerDataProvider — the single shared cache
src/config/    schema.ts (entity + field definitions), env.ts
src/lib/       validate, permissions, csv, rollups, console deep links
src/pages/     Features, FeatureDetail, Actions, Users (admin), Health
scripts/       setup-sheet.gs      Apps Script, run by hand in the sheet
               migrate-workbook.py one-time .xlsm → TSV import
```

`src/sheets/` is deliberately the sole storage-aware module: migrating to an
Apps Script gateway (plan.md §10) would rewrite that folder and nothing else.

The **Health** page shows config, auth and token state and can force a token
refresh from a click — the fastest way to exercise the refresh path without
waiting an hour.

## Quotas

60 read and 60 write requests per user per minute. An update costs ~3 calls
(snapshot, write, audit).

The whole app loads in **one** request: `loadAppData()` batches Features,
Actions and Lists into a single `batchGet`. `TrackerDataProvider` holds that
snapshot for every page, so navigating costs nothing — this is why it is a
provider and not a per-page hook. Users is read separately, once, at sign-in.

## Changes that need the sheet, not the repo

Row 1 of `Features`, `Actions` and `Lists`, plus the whole `Users` and `Audit`
tabs, are protected ranges.

**Adding a channel, release, owner, platform or status is NOT one of these.**
Those are rows in the `Lists` tab, editable by any editor, and the app picks
them up on its next load with no deploy. That is the entire point of the
`reference` field type — do not add them to `schema.ts`. After editing `Lists`,
run `refreshValidation()` so the *in-sheet* dropdowns catch up; the app does not
need it.

These do need an admin acting in Google Sheets:

- **Adding a field:** add an entry to the entity's `fields` in
  `src/config/schema.ts` *and* the matching header cell to row 1 of that
  entity's tab. That one entry drives the form input, the validation and the
  table column.
- **Adding an entity:** a new `EntitySchema` in `entities`, a range in
  `APP_RANGES` (`src/sheets/snapshot.ts`), a tab, and a route. Nothing in
  `collection.ts` or `rows.ts` should need to change — if it does, something
  has been hardcoded that should not be.
- **Adding a person:** three gates, in order — OAuth test user, Drive share,
  `Users` row. The Drive share is the only one Google enforces. The Users page
  links to each step; the runbook is in the README.
- **Re-protecting ranges** after a structural change: `protectRanges()` in
  `scripts/setup-sheet.gs`. It protects `Lists` **row 1 only** on purpose —
  locking the whole tab would put "add a release" back behind an admin.
