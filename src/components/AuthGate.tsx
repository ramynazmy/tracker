import { useAuth } from '../auth/AuthContext'
import AccessDenied from './AccessDenied'
import ErrorScreen from './ErrorScreen'
import SignInScreen from './SignInScreen'

/**
 * Renders children only for a resolved, allowlisted session. Every other state
 * gets its own screen — notably the three denial reasons, which all land on
 * AccessDenied rather than an unhandled error.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()

  switch (state.status) {
    case 'loading':
      return (
        <section className="centered">
          <p className="muted">Checking your access…</p>
        </section>
      )
    case 'signed-out':
    case 'authenticating':
      return <SignInScreen />
    case 'denied':
      return <AccessDenied reason={state.reason} email={state.email} />
    case 'error':
      return <ErrorScreen message={state.message} />
    case 'ready':
      return <>{children}</>
  }
}
