import { useState } from 'react'
import { envStatus } from '../config/env'
import { useAuth } from '../auth/AuthContext'
import { clearToken, peekToken } from '../auth/tokenClient'
import { loadUsers } from '../sheets/users'

/**
 * Deploy and session diagnostics. Exists to make the phase verification steps
 * observable — in particular the token-refresh path, which otherwise has an
 * hour-long feedback loop.
 */
export default function Health() {
  const { state } = useAuth()
  const { ok, missing } = envStatus()
  const [probe, setProbe] = useState<string>('')

  const rows: Array<[string, string]> = [
    ['Base path', import.meta.env.BASE_URL],
    ['Mode', import.meta.env.MODE],
    ['Router', 'HashRouter'],
    ['Config', ok ? 'complete' : `missing: ${missing.join(', ')}`],
    ['Auth state', state.status],
    ['Access token', peekToken() ? 'held in memory' : 'none'],
    ['Web storage', hasTokenInStorage() ? '⚠ token found in storage' : 'clean'],
  ]

  /**
   * Drop the in-memory token, then make a real API call. The call should 401,
   * refresh silently and succeed — exercising in seconds the path that
   * otherwise only occurs an hour into a session.
   */
  async function testRefresh() {
    setProbe('working…')
    clearToken()
    try {
      const users = await loadUsers()
      setProbe(`✓ recovered silently — read ${users.length} user row(s)`)
    } catch (error) {
      setProbe(`✗ ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <section>
      <h1>Health</h1>
      <p className="muted">Hard-refresh this page — it should load, not 404.</p>

      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <code>{v}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card">
        <strong>Token refresh</strong>
        <p className="muted">
          Discards the in-memory token and makes a live API call. It should recover with no
          sign-in prompt.
        </p>
        <div className="row">
          <button className="btn" onClick={() => void testRefresh()}>
            Test silent refresh
          </button>
          {probe && <code>{probe}</code>}
        </div>
      </div>
    </section>
  )
}

/** Guards the rule that no access token ever reaches persistent storage. */
function hasTokenInStorage(): boolean {
  const suspicious = /access_token|ya29\./i
  const scan = (store: Storage) =>
    Object.keys(store).some((key) => suspicious.test(key) || suspicious.test(store.getItem(key) ?? ''))
  try {
    return scan(localStorage) || scan(sessionStorage)
  } catch {
    return false
  }
}
