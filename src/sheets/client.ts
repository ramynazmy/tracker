/**
 * The only module that talks to the Sheets API.
 *
 * Everything about tokens is handled here — callers never think about expiry,
 * refresh or retry. If this app ever migrates to an Apps Script gateway
 * (plan.md §10), this folder is all that changes.
 */

import { requireEnv } from '../config/env'
import { clearToken, getValidToken, requestToken } from '../auth/tokenClient'

const API_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'SheetsError'
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  /**
   * A 403 from the Sheets API conflates three very different problems, and
   * telling someone to "ask an admin to share the sheet" when the real cause is
   * a disabled API sends them down a dead end. Distinguish by the message
   * Google returns.
   */
  get forbiddenKind(): 'api-disabled' | 'insufficient-scope' | 'no-access' {
    const detail = this.detail ?? ''
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(detail)) {
      return 'api-disabled'
    }
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(detail)) {
      return 'insufficient-scope'
    }
    return 'no-access'
  }

  /** Wrong spreadsheet ID: a configuration error, not a permissions one. */
  get isNotFound(): boolean {
    return this.status === 404
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }
}

async function toError(response: Response): Promise<SheetsError> {
  let detail: string | undefined
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    detail = body.error?.message
  } catch {
    // Non-JSON error body; the status alone will have to do.
  }
  return new SheetsError(detail || response.statusText || 'Sheets request failed', response.status, detail)
}

const MAX_ATTEMPTS = 4

function backoffMs(attempt: number): number {
  // 400ms, 800ms, 1600ms, plus jitter so concurrent callers don't resynchronise.
  return 400 * 2 ** attempt + Math.random() * 250
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetch against the configured spreadsheet.
 *
 * Retry policy, which is deliberately asymmetric:
 *
 *   401  refresh the token silently, retry once. Once only — if the fresh token
 *        is also rejected, retrying just loops.
 *   429  always retried. The request was rejected before it was processed, so a
 *        retry cannot duplicate anything.
 *   5xx  retried for GET only. A 5xx on an append may mean the row WAS written
 *        and the response was lost; retrying would silently duplicate a record.
 *        Surfacing the error and letting the user look is the honest option.
 */
export async function sheetsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_ROOT}/${requireEnv('VITE_SPREADSHEET_ID')}${path}`
  const method = (init.method ?? 'GET').toUpperCase()
  const idempotent = method === 'GET'

  const send = async (token: string): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

  let refreshed = false

  for (let attempt = 0; ; attempt++) {
    let response = await send(await getValidToken())

    if (response.status === 401 && !refreshed) {
      refreshed = true
      clearToken()
      response = await send(await requestToken({ silent: true }))
    }

    if (response.ok) return (await response.json()) as T

    const retryable = response.status === 429 || (idempotent && response.status >= 500)
    if (retryable && attempt < MAX_ATTEMPTS - 1) {
      await delay(backoffMs(attempt))
      continue
    }

    throw await toError(response)
  }
}

export interface UserInfo {
  email: string
  name?: string
  picture?: string
  email_verified?: boolean
}

/**
 * The verified identity behind the current token. Google returns this over
 * TLS from its own endpoint, so it is as trustworthy as a signed ID token for
 * our purposes — and it is never user-supplied input.
 */
export async function fetchUserInfo(): Promise<UserInfo> {
  const token = await getValidToken()
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw await toError(response)
  return (await response.json()) as UserInfo
}

/** Read one or more ranges in a single request — cheaper against the quota. */
export interface BatchGetResponse {
  valueRanges?: Array<{ range?: string; values?: unknown[][] }>
}

export function batchGet(ranges: string[]): Promise<BatchGetResponse> {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  return sheetsFetch<BatchGetResponse>(
    `/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`,
  )
}
