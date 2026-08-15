import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext, type AuthState } from './AuthContext'
import { AuthError, requestToken, revokeToken } from './tokenClient'
import { forgetUser, recallUser, rememberUser } from './rememberedUser'
import { fetchUserInfo, SheetsError } from '../sheets/client'
import { loadUsers, resolveUser } from '../sheets/users'

export function GoogleAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  // React StrictMode mounts effects twice in development. Without this the
  // restore attempt fires twice and the second trips the "already in progress"
  // guard in tokenClient.
  const restored = useRef(false)

  /**
   * Turn a token into a resolved session: verified email → allowlist → role.
   * Every denial path lands on the same screen with a different reason.
   */
  const establishSession = useCallback(async () => {
    const info = await fetchUserInfo()

    try {
      const users = await loadUsers()
      const resolution = resolveUser(info.email, users)

      if (!resolution.ok) {
        setState({ status: 'denied', reason: resolution.reason, email: info.email })
        return
      }

      rememberUser({ email: resolution.user.email, displayName: resolution.user.displayName })
      setState({ status: 'ready', user: resolution.user })
    } catch (error) {
      if (error instanceof SheetsError && error.isForbidden) {
        // Surface the raw message — the three causes below are indistinguishable
        // without it, and this is the first thing to check when sign-in fails.
        console.error('[tracker] Sheets 403:', error.detail)

        switch (error.forbiddenKind) {
          case 'api-disabled':
            setState({
              status: 'error',
              message:
                'The Google Sheets API is not enabled on the Cloud project. Enable it at ' +
                'console.cloud.google.com → APIs & Services → Library → Google Sheets API.',
            })
            return
          case 'insufficient-scope':
            setState({
              status: 'error',
              message:
                'Sign-in did not grant access to Google Sheets. Sign out and sign in again, ' +
                'accepting the spreadsheet permission.',
            })
            return
          case 'no-access':
            // A user who was never shared on the spreadsheet cannot even read
            // the Users tab — the allowlist lookup itself 403s. Same denial
            // screen, not a stack trace on their very first visit.
            setState({ status: 'denied', reason: 'not-shared', email: info.email })
            return
        }
      }
      throw error
    }
  }, [])

  const describe = (error: unknown): string =>
    error instanceof SheetsError && error.isNotFound
      ? 'The configured spreadsheet could not be found. Check VITE_SPREADSHEET_ID.'
      : error instanceof Error
        ? error.message
        : 'Something went wrong.'

  /**
   * On load, try to restore without any interaction.
   *
   * This usually fails, and that is expected rather than a bug: a static SPA
   * holds no refresh token, and GIS's `prompt: ''` renewal still opens a popup
   * window, which browsers block without user activation. The attempt is cheap
   * and does succeed in some browsers, so it is worth making — and when it
   * fails we fall back to a one-click resume rather than a full sign-in.
   */
  useEffect(() => {
    if (restored.current) return
    restored.current = true

    void (async () => {
      try {
        await requestToken({ silent: true })
        await establishSession()
      } catch (error) {
        if (error instanceof AuthError) {
          console.info(
            `[tracker] silent restore unavailable (${error.kind}) — showing one-click resume.`,
            error.message,
          )
          setState({ status: 'signed-out' })
          return
        }
        setState({ status: 'error', message: describe(error) })
      }
    })()
  }, [establishSession])

  /**
   * Interactive sign-in. The click is what makes this work where the silent
   * attempt could not: it grants the user activation the popup needs.
   *
   * `resume` reuses the existing Google session, so someone continuing as
   * themselves sees no account chooser and no consent screen — one click.
   */
  const signIn = useCallback(
    async ({ resume = false }: { resume?: boolean } = {}) => {
      setState({ status: 'authenticating' })
      try {
        await requestToken({ silent: resume })
        await establishSession()
      } catch (error) {
        if (error instanceof AuthError) {
          if (resume) {
            // The remembered session is no longer usable — the Google session
            // expired, or the account was signed out elsewhere.
            forgetUser()
            setState({ status: 'signed-out' })
            return
          }
          setState(
            error.kind === 'declined' || error.kind === 'interaction-required'
              ? { status: 'signed-out' }
              : { status: 'error', message: error.message },
          )
          return
        }
        setState({ status: 'error', message: describe(error) })
      }
    },
    [establishSession],
  )

  const signOut = useCallback(async () => {
    await revokeToken()
    forgetUser()
    sessionStorage.clear()
    setState({ status: 'signed-out' })
  }, [])

  const retry = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      await establishSession()
    } catch (error) {
      setState({ status: 'error', message: describe(error) })
    }
  }, [establishSession])

  const value = useMemo(
    () => ({ state, signIn, signOut, retry, remembered: recallUser() }),
    [state, signIn, signOut, retry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
