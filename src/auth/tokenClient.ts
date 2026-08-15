/**
 * Google Identity Services access-token lifecycle.
 *
 * One token covers both identity and Sheets — scope is `email profile
 * spreadsheets`, and the verified email comes from a single /userinfo call.
 * That avoids running `google.accounts.id` (One Tap) alongside the token
 * client: two lifecycles, two prompts, and One Tap is entangled with FedCM and
 * third-party-cookie changes that keep moving. See plan.md §7.
 *
 * The token lives in module memory only — never localStorage, never
 * sessionStorage. It expires in ~1h and is re-acquired silently.
 */

import { requireEnv } from '../config/env'

export const SCOPES = [
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

const GIS_SRC = 'https://accounts.google.com/gsi/client'

/** Refresh this long before actual expiry, so calls never race the deadline. */
const EXPIRY_MARGIN_MS = 60_000

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

function oauth2(): GoogleOAuth2 {
  const g = (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }).google
  const api = g?.accounts?.oauth2
  if (!api) throw new Error('Google Identity Services not loaded')
  return api
}

export class AuthError extends Error {
  constructor(
    message: string,
    /** 'interaction-required' means a silent refresh failed and a click is needed. */
    readonly kind: 'interaction-required' | 'popup-blocked' | 'declined' | 'unknown' = 'unknown',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// ---------------------------------------------------------------------------
// Script loading
// ---------------------------------------------------------------------------

let gisPromise: Promise<void> | null = null

/** Injects the GIS script once; subsequent callers await the same promise. */
export function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise

  gisPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new AuthError('Failed to load Google sign-in')))
      return
    }

    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new AuthError('Failed to load Google sign-in'))
    document.head.appendChild(script)
  })

  return gisPromise
}

// ---------------------------------------------------------------------------
// Token acquisition
// ---------------------------------------------------------------------------

let client: TokenClient | null = null
let accessToken: string | null = null
let expiresAt = 0

/** Resolver for the in-flight requestAccessToken call — GIS is callback-based. */
let pending: { resolve: (token: string) => void; reject: (error: AuthError) => void } | null = null

async function getClient(): Promise<TokenClient> {
  if (client) return client
  await loadGis()

  client = oauth2().initTokenClient({
    client_id: requireEnv('VITE_GOOGLE_CLIENT_ID'),
    scope: SCOPES,
    callback: (response) => {
      const settle = pending
      pending = null
      if (!settle) return

      if (response.error || !response.access_token) {
        // `interaction_required` / `consent_required` are what a silent attempt
        // returns when there is no usable Google session to reuse.
        const kind =
          response.error === 'interaction_required' || response.error === 'consent_required'
            ? 'interaction-required'
            : response.error === 'access_denied'
              ? 'declined'
              : 'unknown'
        settle.reject(new AuthError(response.error_description || response.error || 'Sign-in failed', kind))
        return
      }

      accessToken = response.access_token
      const ttl = Number(response.expires_in ?? 3600) * 1000
      expiresAt = Date.now() + ttl
      settle.resolve(response.access_token)
    },
    error_callback: (error) => {
      const settle = pending
      pending = null
      if (!settle) return
      const kind =
        error.type === 'popup_failed_to_open'
          ? 'popup-blocked'
          : error.type === 'popup_closed'
            ? 'declined'
            : 'interaction-required'
      settle.reject(new AuthError(error.message || 'Sign-in was not completed', kind))
    },
  })

  return client
}

/**
 * Request a token.
 *
 * `silent: true` passes `prompt: ''`, which reuses a live Google session with
 * no UI at all. That is what makes an idle tab keep working past the ~1h expiry
 * and what restores a session across a page reload.
 *
 * `silent: false` shows the account chooser and MUST be called from a real user
 * gesture — from a mount effect the popup is blocked and the app appears to hang.
 */
export async function requestToken({ silent }: { silent: boolean }): Promise<string> {
  const tokenClient = await getClient()

  if (pending) throw new AuthError('A sign-in request is already in progress')

  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    try {
      // prompt: '' → reuse the existing session silently.
      // no overrides → GIS shows the account chooser and consent as needed.
      tokenClient.requestAccessToken(silent ? { prompt: '' } : undefined)
    } catch (error) {
      pending = null
      reject(new AuthError(error instanceof Error ? error.message : 'Sign-in failed'))
    }
  })
}

/** Cached token if still comfortably valid, otherwise a silent refresh. */
export async function getValidToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt - EXPIRY_MARGIN_MS) return accessToken
  return requestToken({ silent: true })
}

export function peekToken(): string | null {
  return accessToken
}

export function clearToken(): void {
  accessToken = null
  expiresAt = 0
}

/**
 * Revoke the grant as well as dropping the token. Without revoking, "sign out,
 * sign in as someone else" silently reuses the previous account — which makes
 * testing the role behaviour in Phase 5 maddening.
 */
export async function revokeToken(): Promise<void> {
  const token = accessToken
  clearToken()
  if (!token) return
  try {
    await new Promise<void>((resolve) => oauth2().revoke(token, () => resolve()))
  } catch {
    // Revocation is best-effort; the local token is already gone.
  }
}
