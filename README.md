# Tracker

Feature and action tracker for the DDC architecture team. A single-page app served from GitHub
Pages that reads and writes a Google Sheet. No server, no database, no hosting cost — the Sheet is
the storage and Google's own identity and file-permission systems are the access control.

Full design and phased build plan: **[plan.md](./plan.md)**

**Live:** <https://ramynazmy.github.io/tracker/>

## What it does

Sign in with Google, then track two things:

- **Features** — a piece of work belonging to a channel and a release, with a status, complexity,
  owner and ASD state.
- **Actions** — something that has to happen about a feature. Each action points at its feature by
  UUID, so renaming a feature never orphans its actions. Every action has a **type** (the kind of
  architecture work — solution design, review, impact assessment…) and an **actor** (who does it).

Open a feature to see its actions and raise new ones. The Dashboard leads with percent complete and
the counts; the Actions page lists everything still open, with days overdue.

### Actions vs events

The Actions tab is the **whole timeline**, not only the architecture team's workload. An action
whose actor is someone else — Delivery, Vendor, Business — is an *event*: it is there so the
feature's progress reads end to end, not because anyone here has to do it.

That distinction is load-bearing. A feature's **Open Actions** count, and the dashboard's
**Open on us** and **Overdue** figures, deliberately count only rows the architecture team owes.
Filter the Actions page by actor to see everything, or just what is ours.

An action with no actor set counts as ours.

**Adding an actor** is a row in `Lists` — no code, no deploy. New actors are treated as *not* ours,
so they join the timeline without inflating the team's open counts.

**If a new actor should count as ours** — say the architecture function splits into solution and
enterprise — put `ours` in that row's `parent` column. Mark every actor that qualifies: once any row
carries the marker, only the marked rows count. Marking nothing keeps the default (Architecture).

Three roles — `admin`, `editor`, `viewer` — with an admin screen for managing people, CSV export,
and an audit log of every write.

### Channels, releases, owners and statuses live in the Sheet

They are rows in the **`Lists`** tab, not values in the code. Adding a release is a row an editor
types; the app picks it up on its next load. No code change, no deploy.

Two rules make that safe:

- Records store a **stable id** (`business-banking-r3`) and the `Lists` tab holds the label people
  read. Renaming a channel is one cell edit, not a rewrite of every feature that uses it.
- Retire a value by setting `active = FALSE`. **Never delete the row** — deleting it strands every
  record that referenced it.

Releases are scoped to a channel via the `parent` column, so `R6` under one channel is a different
release from `R6` under another. Choosing a Channel in the form narrows the Release dropdown.

After editing `Lists`, run `refreshValidation()` in Apps Script to update the *in-sheet* dropdowns.
The app does not need it.

## Commands

| | |
|---|---|
| `npm run dev` | dev server on **port 5173** (pinned — it is a registered OAuth origin) |
| `npm run build` | typecheck + tests + production build into `dist/` |
| `npm test` | tests only |
| `npm run preview` | serve the production build locally |

Tests run as part of `npm run build`, so a failing test blocks the deploy.

Deployment is automatic: push to `main` and GitHub Actions builds and publishes to Pages in about
two minutes.

## Setup

Build-time variables, in `.env.production` (committed) or `.env.local` (dev):

```
VITE_SPREADSHEET_ID     the middle part of the Sheet URL
VITE_GOOGLE_CLIENT_ID   from Google Cloud → Credentials, ends .apps.googleusercontent.com
VITE_GCP_PROJECT_ID     optional — only deep-links the admin runbook to the right Cloud project
```

> **Neither is a secret.** OAuth client IDs are public identifiers and this flow uses no client
> secret; the spreadsheet ID grants nothing on its own, because Drive sharing is the actual gate.
>
> 🚫 **Never** add a service-account key, a client secret, or a write-scoped API key to this repo.
> Everything here ships inside the JS bundle that GitHub Pages serves publicly — private repo or
> not. There is no safe way to hold a secret in a static SPA.

Full first-time Google Cloud and Sheet setup is Phase 0 in [plan.md](./plan.md).

## First sign-in: the "unverified app" warning

The OAuth consent screen is deliberately left in **Testing** status, which avoids Google's
sensitive-scope verification review. The trade-off is that every user sees this on their first
sign-in:

> **Google hasn't verified this app**

This is expected, and it is **not** a sign that anything is wrong. To continue:

```
   ┌──────────────────────────────────────────────┐
   │  Google hasn't verified this app             │
   │                                              │
   │  The app is requesting access to sensitive   │
   │  info in your Google Account.                │
   │                                              │
   │  ▸ Advanced          ← 1. click this         │
   │                                              │
   │    Go to Tracker (unsafe)  ← 2. then this    │
   │                                              │
   │              [ Back to safety ]              │
   └──────────────────────────────────────────────┘
```

It appears once per account. Testing status also caps the app at **100 users**.

### A different screen: "Access blocked"

If instead you see **"Access blocked: … has not completed the Google verification process"** with
`Error 403: access_denied`, that is not the same thing — it means your account has not been added
as a **test user** in the Cloud console. Ask an administrator to add you (step 1 of the runbook
below).

## Managing access

Three independent gates. A user must pass all three, and they are added in this order:

```
ADDING A USER
  1. Cloud console → OAuth consent screen → add as TEST USER
  2. Sheet → Share → Editor (admin/editor)  or  Viewer (viewer)
  3. Users tab → email │ role │ name │ active = TRUE

REMOVING A USER
  1. Users tab → active = FALSE
  2. Sheet → Share → remove them      ◀── the one that actually matters
  3. Cloud console → remove test user
```

**Step 2 is the real boundary.** The app's UI is not a security boundary — a user can call the
Sheets API directly or open the Sheet in Google Sheets. What stops a `viewer` writing is that Drive
says Viewer, so Google itself rejects the write. Skip step 2 when adding and the role column is
decoration; skip it when removing and the person keeps full access to the raw Sheet.

⏱ An already-issued access token stays valid for up to an hour after unsharing. There is no way to
revoke it earlier from a static SPA.

### Roles

| Role | Drive sharing | Can do |
|---|---|---|
| `admin` | Editor | everything, including the Users and Audit tabs |
| `editor` | Editor | create, edit and delete features and actions, and edit the `Lists` vocabularies |
| `viewer` | **Viewer** | read only — enforced by Google, not by the UI |

The `Users` and `Audit` tabs, and row 1 of `Features`, `Actions` and `Lists`, are protected in the
Sheet so only admins can edit them. Row 1 is protected because it is the Sheet↔app column contract.

Note that only **row 1** of `Lists` is locked — the rows below it are deliberately left editable, so
adding a release stays a data edit rather than an admin task.

## Conventions

- **`HashRouter`** — URLs contain `#` (`/tracker/#/features/<uuid>`). GitHub Pages has no rewrite rules,
  so `BrowserRouter` would 404 on a hard refresh of a deep link.
- **`base: '/tracker/'`** in `vite.config.ts` must match the repo name. Wrong value produces a white
  page with 404s on every asset — the most common Pages failure.
- **Port 5173 is pinned** (`strictPort`). Vite silently moving to 5174 would break OAuth with an
  origin mismatch that looks nothing like a port problem.
- **Row numbers are never identity.** Every record carries a UUID; row indexes are re-resolved
  immediately before any write, because sorting the Sheet moves rows.
- **Text written to the Sheet is sanitised.** `USER_ENTERED` turns a leading `=` into a live
  formula, and `=IMAGE(...)` can exfiltrate cell contents to an external URL.
- **Do not put formulas in the `Features` or `Actions` tabs.** The app writes a whole row at a
  time, so a formula anywhere in that row is silently replaced with a blank the next time anyone
  edits that record. Counts and rollups — like the Open Actions column — are calculated by the app
  instead. This is the one habit worth unlearning if you came from the workbook.

## Troubleshooting

| Symptom | Cause |
|---|---|
| White page, 404s on every asset | `base` in `vite.config.ts` does not match the repo name |
| "Access blocked … access_denied" | account not added as an OAuth test user |
| "The Google Sheets API is not enabled" | enable it on the Cloud project |
| "Sign-in did not grant access to Google Sheets" | scope added after the grant — revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and sign in again |
| "No access" after signing in | not shared on the Sheet, absent from `Users`, or `active = FALSE` |
| "Your access level changed" on save | the `Users` role and the Drive sharing level disagree |
| `Sheet is missing column X` | a header in that tab's row 1 was renamed or deleted — the message names the tab |
| The tab does not exist at all | run `setupTracker()` from the spreadsheet's Apps Script editor |
| A value shows as a highlighted "unknown" chip | it has no matching row in `Lists` — usually typed straight into the Sheet |

The **Health** page shows config, auth state and token status, and has a button that forces a token
refresh — useful for confirming the silent-refresh path without waiting an hour.

## Development against a copy

`npm run dev` uses `.env.local` if present. Point it at a **copy** of the spreadsheet so development
writes do not land in real data:

```
cp .env.example .env.local     # then set VITE_SPREADSHEET_ID to the copy
```
