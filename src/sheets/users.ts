/**
 * The allowlist. Reads and writes the Users tab.
 *
 * This is NOT the security boundary — a user who is shared on the spreadsheet
 * can call the Sheets API directly and ignore whatever this says. Real
 * enforcement is the Drive sharing level plus protected ranges (plan.md §2).
 * This exists so the UI renders the right things and so people are managed in
 * one place.
 *
 * The Users tab is protected against editors, so a write here 403s for anyone
 * who is not an admin. That is the intended behaviour, not a bug to work
 * around.
 */

import { batchGet, sheetsFetch } from './client'

/** Fixed layout, created by scripts/setup-sheet.gs and protected against edits. */
export const USERS_RANGE = 'Users!A:E'
const COLUMNS = ['email', 'role', 'displayName', 'active', 'notes'] as const

export type Role = 'admin' | 'editor' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']

export interface TrackerUser {
  email: string
  role: Role
  displayName: string
  active: boolean
  notes: string
}

export function normaliseEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * `active` is a checkbox, so the API returns a real boolean — but a hand-typed
 * "TRUE" or "yes" should work too, since people edit this tab directly.
 */
function isTruthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === '1'
}

function toRole(value: unknown): Role | null {
  const text = String(value ?? '').trim().toLowerCase()
  return (ROLES as readonly string[]).includes(text) ? (text as Role) : null
}

interface UsersSnapshot {
  users: TrackerUser[]
  /** 1-based sheet row per email, valid only for this snapshot. */
  rowNumbers: Map<string, number>
}

async function snapshot(): Promise<UsersSnapshot> {
  const response = await batchGet([USERS_RANGE])
  const rows = response.valueRanges?.[0]?.values ?? []
  const [, ...dataRows] = rows

  const users: TrackerUser[] = []
  const rowNumbers = new Map<string, number>()

  dataRows.forEach((row, offset) => {
    const email = normaliseEmail(row[0])
    const role = toRole(row[1])
    if (!email || !role) return

    rowNumbers.set(email, offset + 2) // +1 header, +1 for 1-based
    users.push({
      email,
      role,
      displayName: String(row[2] ?? '').trim() || email,
      active: isTruthy(row[3]),
      notes: String(row[4] ?? '').trim(),
    })
  })

  return { users, rowNumbers }
}

export async function loadUsers(): Promise<TrackerUser[]> {
  return (await snapshot()).users
}

export type Denial = 'not-listed' | 'inactive'

export type Resolution = { ok: true; user: TrackerUser } | { ok: false; reason: Denial }

export function resolveUser(email: string, users: TrackerUser[]): Resolution {
  const match = users.find((u) => u.email === normaliseEmail(email))
  if (!match) return { ok: false, reason: 'not-listed' }
  if (!match.active) return { ok: false, reason: 'inactive' }
  return { ok: true, user: match }
}

function toRow(user: TrackerUser): unknown[] {
  return [user.email, user.role, user.displayName, user.active, user.notes]
}

/**
 * Create or update a user row, matched on email.
 *
 * Only admins can succeed: the Users tab is a protected range, so Google
 * rejects this for editors and viewers regardless of what the UI allowed.
 */
export async function saveUser(user: TrackerUser): Promise<void> {
  const email = normaliseEmail(user.email)
  const { rowNumbers } = await snapshot()
  const rowNumber = rowNumbers.get(email)
  const values = [toRow({ ...user, email })]

  if (rowNumber) {
    await sheetsFetch(
      `/values/${encodeURIComponent(`Users!A${rowNumber}:E${rowNumber}`)}` +
        '?valueInputOption=USER_ENTERED',
      { method: 'PUT', body: JSON.stringify({ values }) },
    )
    return
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(USERS_RANGE)}:append` +
      '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values }) },
  )
}

export { COLUMNS as USERS_COLUMNS }
