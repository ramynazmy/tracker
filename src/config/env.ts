/**
 * Build-time configuration.
 *
 * Neither of these is a secret:
 *   - OAuth client IDs are public identifiers; this flow uses no client secret.
 *   - The spreadsheet ID grants nothing on its own — Drive sharing is the gate.
 * Both are committed in .env.production. See plan.md §6.
 *
 * NEVER add a service-account key, a client secret, or a write-scoped API key
 * here. Everything in this repo ships inside the JS bundle that GitHub Pages
 * serves publicly, private repo or not.
 */

// Read statically, one property at a time. Vite substitutes `import.meta.env.VITE_X`
// at build time by literal text replacement — a dynamic lookup like
// `import.meta.env[name]` is NOT substituted and comes back undefined in a
// production build while working fine in dev. Do not "simplify" this into a loop.
const raw = {
  VITE_SPREADSHEET_ID: import.meta.env.VITE_SPREADSHEET_ID,
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
} as const

/**
 * Optional. Only used to deep-link the admin runbook straight to the right
 * Cloud console page; without it the links still work, they just make you pick
 * the project. Not required, so it is kept out of `raw` and its checks.
 */
export const GCP_PROJECT_ID: string | undefined = import.meta.env.VITE_GCP_PROJECT_ID

export type EnvKey = keyof typeof raw

/** Non-throwing check, so the shell can render a readable diagnostic. */
export function envStatus(): { ok: boolean; missing: EnvKey[] } {
  const missing = (Object.keys(raw) as EnvKey[]).filter((k) => !raw[k])
  return { ok: missing.length === 0, missing }
}

/**
 * Throwing accessor, used by the auth and sheets modules from Phase 2 onward.
 * Fails loudly at the point of use: a missing variable otherwise surfaces as a
 * confusing OAuth error rather than a message naming the variable.
 */
export function requireEnv(key: EnvKey): string {
  const value = raw[key]
  if (!value) throw new Error(`Missing ${key} — see README §Setup`)
  return value
}
