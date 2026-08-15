import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { GoogleAuthProvider } from './auth/GoogleAuthProvider'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found in index.html')

createRoot(root).render(
  <StrictMode>
    {/*
      HashRouter, not BrowserRouter — see plan.md §5.
      GitHub Pages is a static file server with no rewrite rules, so a hard
      refresh on /records/123 would 404. Hash routes (#/records/123) avoid the
      404.html workaround entirely.
    */}
    <ErrorBoundary>
      <HashRouter>
        <GoogleAuthProvider>
          <App />
        </GoogleAuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
