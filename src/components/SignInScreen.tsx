import { useAuth } from '../auth/AuthContext'

export default function SignInScreen() {
  const { state, signIn, remembered } = useAuth()
  const busy = state.status === 'authenticating'

  /**
   * After a reload we know who was here, but not their token — a static SPA
   * holds no refresh token, and the silent renewal needs a user gesture that a
   * page load cannot provide. So: one click, and because it reuses the live
   * Google session there is no account chooser and no consent screen.
   */
  if (remembered) {
    return (
      <section className="centered">
        <h1>Welcome back</h1>
        <p className="muted">
          Signed in as <code>{remembered.email}</code>
        </p>

        <button
          className="btn btn--primary"
          onClick={() => void signIn({ resume: true })}
          disabled={busy}
          autoFocus
        >
          {busy ? 'Continuing…' : 'Continue'}
        </button>

        <div className="row">
          <button className="btn btn--link" onClick={() => void signIn()} disabled={busy}>
            Use a different account
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="centered">
      <h1>Tracker</h1>
      <p className="muted">Sign in with the Google account you were granted access with.</p>

      <button className="btn btn--primary" onClick={() => void signIn()} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in with Google'}
      </button>

      <div className="card card--info">
        <strong>First time signing in?</strong>
        <p className="muted">
          Google will warn that this app is unverified. That is expected — the app is deliberately
          kept in testing status. Click <em>Advanced</em>, then <em>Go to Tracker (unsafe)</em>. You
          will only see this once.
        </p>
      </div>
    </section>
  )
}
