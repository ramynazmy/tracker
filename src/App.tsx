import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import AuthGate from './components/AuthGate'
import TrackerDataProvider from './data/TrackerDataProvider'
import Dashboard from './pages/Dashboard'
import Features from './pages/Features'
import FeatureDetail from './pages/FeatureDetail'
import Actions from './pages/Actions'
import Users from './pages/Users'
import Health from './pages/Health'
import { canManageUsers } from './lib/permissions'
import { useOnline } from './hooks/useOnline'

function UserBadge() {
  const { state, signOut } = useAuth()
  if (state.status !== 'ready') return null

  return (
    <div className="app__user">
      <span className="app__role">{state.user.role}</span>
      <span className="muted">{state.user.displayName}</span>
      <button className="btn btn--link" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}

export default function App() {
  const { state } = useAuth()
  const signedIn = state.status === 'ready'
  const isAdmin = state.status === 'ready' && canManageUsers(state.user.role)
  const email = state.status === 'ready' ? state.user.email : ''
  const online = useOnline()

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__brand">Tracker</span>
        {signedIn && (
          <nav className="app__nav">
            <Link to="/">Dashboard</Link>
            <Link to="/features">Features</Link>
            <Link to="/actions">Actions</Link>
            {isAdmin && <Link to="/users">Users</Link>}
            <Link to="/health">Health</Link>
          </nav>
        )}
        <UserBadge />
      </header>

      {!online && (
        <div className="banner" role="status">
          You are offline — showing the data already loaded. Saving will not work until you
          reconnect.
        </div>
      )}

      <main className="app__main app__main--wide">
        <AuthGate>
          {/* Inside the gate, so it never fetches for a signed-out or denied
              user. One provider for the whole app: the features list and a
              feature's detail page share a single load. */}
          <TrackerDataProvider actorEmail={email}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/features" element={<Features />} />
              <Route path="/features/:id" element={<FeatureDetail />} />
              <Route path="/actions" element={<Actions />} />
              <Route path="/users" element={<Users />} />
              <Route path="/health" element={<Health />} />
              <Route path="*" element={<Navigate to="/features" replace />} />
            </Routes>
          </TrackerDataProvider>
        </AuthGate>
      </main>
    </div>
  )
}
