import { GCP_PROJECT_ID, requireEnv } from '../config/env'

/**
 * Deep links into the Google consoles, so the admin runbook is clickable
 * rather than a set of directions to follow by hand.
 */

function withProject(url: string): string {
  return GCP_PROJECT_ID ? `${url}?project=${encodeURIComponent(GCP_PROJECT_ID)}` : url
}

/** Test users live under Audience in the current console, OAuth consent screen in the old one. */
export const TEST_USERS_URL = withProject('https://console.cloud.google.com/auth/audience')

export const SCOPES_URL = withProject('https://console.cloud.google.com/auth/scopes')

export const CREDENTIALS_URL = withProject('https://console.cloud.google.com/apis/credentials')

/**
 * The spreadsheet itself. Google offers no reliable deep link to the sharing
 * dialog, so this opens the sheet and the instruction says to use Share.
 */
export function spreadsheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${requireEnv('VITE_SPREADSHEET_ID')}/edit`
}

/** Where a user revokes a stale grant after scopes change. */
export const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions'
