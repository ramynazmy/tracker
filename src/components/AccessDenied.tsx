import { useAuth } from '../auth/AuthContext'
import type { DenialReason } from '../auth/AuthContext'

const EXPLANATIONS: Record<DenialReason, string> = {
  'not-shared':
    'Your account does not have access to the tracker spreadsheet. An administrator needs to share it with you.',
  'not-listed':
    'Your account is not registered in the tracker. An administrator needs to add you to the Users list.',
  inactive: 'Your access to the tracker has been deactivated.',
}

export default function AccessDenied({ reason, email }: { reason: DenialReason; email: string }) {
  const { signOut } = useAuth()

  return (
    <section className="centered">
      <h1>No access</h1>
      <p className="muted">
        Signed in as <code>{email}</code>
      </p>

      <div className="card card--warn">
        <p>{EXPLANATIONS[reason]}</p>
        <p className="muted">
          Contact the tracker administrator and mention the email address above.
        </p>
      </div>

      <button className="btn" onClick={() => void signOut()}>
        Sign in with a different account
      </button>
    </section>
  )
}
