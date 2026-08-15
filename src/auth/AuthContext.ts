import { createContext, useContext } from 'react'
import type { Role, TrackerUser } from '../sheets/users'
import type { RememberedUser } from './rememberedUser'

/** Why the gate turned someone away. All three render the same screen. */
export type DenialReason =
  | 'not-shared' // 403 from the API: never shared on the spreadsheet
  | 'not-listed' // shared, but absent from the Users tab
  | 'inactive' // present but active = FALSE

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'authenticating' }
  | { status: 'denied'; reason: DenialReason; email: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; user: TrackerUser }

export interface AuthContextValue {
  state: AuthState
  /**
   * `resume: true` reuses the existing Google session — no account chooser, no
   * consent screen. Used for the one-click resume after a reload.
   */
  signIn: (options?: { resume?: boolean }) => Promise<void>
  signOut: () => Promise<void>
  retry: () => Promise<void>
  /** Identity hint from this tab's previous session. Never a credential. */
  remembered: RememberedUser | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <GoogleAuthProvider>')
  return value
}

/** Convenience for the common "what may this person do" checks. */
export function useRole(): Role | null {
  const { state } = useAuth()
  return state.status === 'ready' ? state.user.role : null
}
