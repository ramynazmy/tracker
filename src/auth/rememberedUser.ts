/**
 * Who was signed in last, so a reload can offer one-click resume.
 *
 * Identity only — NEVER the access token. The token stays in module memory so
 * an XSS bug cannot read it from storage. sessionStorage is per-tab and clears
 * when the tab closes, which is the right lifetime for a hint like this.
 */

const KEY = 'tracker.lastUser'

export interface RememberedUser {
  email: string
  displayName: string
}

export function rememberUser(user: RememberedUser): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    // Private browsing or a full quota. A missing hint costs one extra click.
  }
}

export function recallUser(): RememberedUser | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RememberedUser>
    return parsed.email ? { email: parsed.email, displayName: parsed.displayName || parsed.email } : null
  } catch {
    return null
  }
}

export function forgetUser(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to do; the value expires with the tab anyway.
  }
}
