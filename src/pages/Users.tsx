import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { canManageUsers, ACCESS_CHANGED_MESSAGE } from '../lib/permissions'
import { SheetsError } from '../sheets/client'
import { loadUsers, normaliseEmail, ROLES, saveUser, type Role, type TrackerUser } from '../sheets/users'
import { spreadsheetUrl, TEST_USERS_URL } from '../lib/links'

export default function Users() {
  const { state } = useAuth()
  const [users, setUsers] = useState<TrackerUser[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const started = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await loadUsers())
      setMessage(null)
    } catch (error) {
      setMessage(describe(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void refresh()
  }, [refresh])

  if (state.status !== 'ready') return null
  if (!canManageUsers(state.user.role)) {
    return (
      <section>
        <h1>Users</h1>
        <div className="card card--warn">
          <p>Only administrators can manage users.</p>
        </div>
      </section>
    )
  }

  const self = state.user.email

  async function persist(user: TrackerUser) {
    setBusy(user.email)
    const previous = users
    setUsers((prev) => prev.map((u) => (u.email === user.email ? user : u)))
    try {
      await saveUser(user)
      setMessage(null)
    } catch (error) {
      setUsers(previous)
      setMessage(describe(error))
    } finally {
      setBusy(null)
    }
  }

  async function add(user: TrackerUser) {
    if (users.some((u) => u.email === user.email)) {
      setMessage(`${user.email} is already listed.`)
      return
    }
    setBusy(user.email)
    try {
      await saveUser(user)
      await refresh()
    } catch (error) {
      setMessage(describe(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="muted">{users.length} listed</p>
        </div>
        <button className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="card card--info">
        <strong>Adding someone takes three steps, not one</strong>
        <ol className="steps">
          <li>
            <a href={TEST_USERS_URL} target="_blank" rel="noreferrer">
              Cloud console → Audience
            </a>{' '}
            <span className="muted">→ add them under Test users</span>
          </li>
          <li>
            <a href={spreadsheetUrl()} target="_blank" rel="noreferrer">
              Open the spreadsheet
            </a>{' '}
            <span className="muted">
              → Share → <strong>Editor</strong> for admin and editor, <strong>Viewer</strong> for
              viewer
            </span>
          </li>
          <li>
            {/* Not an href="#add-user": under HashRouter that would be read as
                a route change and bounce back to Records. */}
            <button
              className="btn btn--link btn--inline"
              onClick={() =>
                document.getElementById('add-user')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              Add the row below
            </button>
          </li>
        </ol>
        <p className="muted">
          <strong>Step 2 is the real boundary</strong> — it is what Google enforces. A viewer is
          stopped from writing because Drive says Viewer, not because this app hides the buttons.
          Skip it and the role here is decorative.
        </p>
        <p className="muted">
          Removing someone reverses the order: untick Active below, then{' '}
          <a href={spreadsheetUrl()} target="_blank" rel="noreferrer">
            unshare the sheet
          </a>
          , then remove them from{' '}
          <a href={TEST_USERS_URL} target="_blank" rel="noreferrer">
            Test users
          </a>
          . Unsharing is the step that actually cuts them off — and an
          already-issued token stays valid for up to an hour.
        </p>
      </div>

      {message && (
        <div className="card card--warn">
          <p>{message}</p>
        </div>
      )}

      <div className="table-scroll">
        <table className="records">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.email}>
                <td>
                  <code>{user.email}</code>
                  {user.email === self && <span className="chip chip--self">you</span>}
                </td>
                <td>{user.displayName}</td>
                <td>
                  <select
                    className="input input--inline"
                    value={user.role}
                    disabled={busy === user.email || user.email === self}
                    // Changing your own role would lock you out of this page
                    // with no way back except editing the sheet by hand.
                    title={user.email === self ? 'You cannot change your own role' : undefined}
                    onChange={(e) => void persist({ ...user, role: e.target.value as Role })}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={user.active}
                    disabled={busy === user.email || user.email === self}
                    title={user.email === self ? 'You cannot deactivate yourself' : undefined}
                    onChange={(e) => void persist({ ...user, active: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddUser onAdd={(user) => void add(user)} busy={busy !== null} />
    </section>
  )
}

function AddUser({ onAdd, busy }: { onAdd: (user: TrackerUser) => void; busy: boolean }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('viewer')

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  return (
    <form
      id="add-user"
      className="add-user"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid) return
        onAdd({
          email: normaliseEmail(email),
          displayName: displayName.trim() || normaliseEmail(email),
          role,
          active: true,
          notes: '',
        })
        setEmail('')
        setDisplayName('')
        setRole('viewer')
      }}
    >
      <h2>Add a user</h2>
      <div className="add-user__row">
        <input
          className="input"
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="btn btn--primary" type="submit" disabled={!valid || busy}>
          Add
        </button>
      </div>
    </form>
  )
}

function describe(error: unknown): string {
  if (error instanceof SheetsError && error.isForbidden) return ACCESS_CHANGED_MESSAGE
  return error instanceof Error ? error.message : String(error)
}
