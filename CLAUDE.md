# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A React SPA on GitHub Pages that reads and writes a Google Sheet. No server.
Design and phase history: [plan.md](./plan.md). User-facing setup, the access
runbook and troubleshooting: [README.md](./README.md).

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
src/config/    schema.ts (field definitions), env.ts
src/lib/       validation, permissions, csv, console deep links
src/pages/     Records, Users (admin only), Health (diagnostics)
scripts/       setup-sheet.gs — Apps Script, run by hand in the sheet
```

`src/sheets/` is deliberately the sole storage-aware module: migrating to an
Apps Script gateway (plan.md §10) would rewrite that folder and nothing else.

The **Health** page shows config, auth and token state and can force a token
refresh from a click — the fastest way to exercise the refresh path without
waiting an hour.

## Quotas

60 read and 60 write requests per user per minute. An update costs ~3 calls
(snapshot, write, audit). Reads are batched and cached; the hooks do not refetch
on navigation for this reason.

## Changes that need the sheet, not the repo

Row 1 of `Records` and the whole `Users` and `Audit` tabs are protected ranges,
so these need an admin acting in Google Sheets:

- **Adding a field:** add an entry to `schema.fields` in `src/config/schema.ts`
  *and* the matching header cell to row 1 of `Records`. That one entry drives the
  form input, the validation and the table column.
- **Adding a person:** three gates, in order — OAuth test user, Drive share,
  `Users` row. The Drive share is the only one Google enforces. The Users page
  links to each step; the runbook is in the README.
- **Re-protecting ranges** after a structural change: `protectRanges()` in
  `scripts/setup-sheet.gs`.
