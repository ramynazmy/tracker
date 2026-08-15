import type { Role } from '../sheets/users'

/**
 * What the UI should offer. These are NOT security checks — the browser talks
 * to the Sheets API directly, so a user can bypass every one of them.
 *
 * Real enforcement is Google's: a `viewer` is shared as Drive Viewer, so every
 * write they attempt is rejected at the API regardless of what the app renders.
 * These predicates exist so people are not shown buttons that will fail, and so
 * the interface matches their actual capability. See plan.md §2.
 */

export function canWriteRecords(role: Role): boolean {
  return role === 'admin' || role === 'editor'
}

export function canManageUsers(role: Role): boolean {
  return role === 'admin'
}

/** Message shown when a write is refused before it is attempted. */
export const READ_ONLY_MESSAGE = 'Your access is read-only.'

/**
 * A 403 on a write means the Users tab role and the Drive sharing level have
 * drifted apart — the app believed you could write and Google disagreed. The
 * app cannot detect this in advance: reading Drive permissions would require
 * enabling the Drive API and another sensitive scope.
 */
export const ACCESS_CHANGED_MESSAGE =
  'Your access level changed — reload the page. If this persists, ask an administrator to check your sharing on the spreadsheet.'
