import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/**
 * Catches render-time crashes.
 *
 * Without this, a React error unmounts the tree and leaves a blank white page —
 * indistinguishable from the base-path misconfiguration that is the classic
 * GitHub Pages failure. Two very different problems should not look identical.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[tracker] render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app">
        <header className="app__bar">
          <span className="app__brand">Tracker</span>
        </header>
        <main className="app__main">
          <section className="centered">
            <h1>Something went wrong</h1>
            <div className="card card--warn">
              <p>{error.message}</p>
              <p className="muted">
                The page needs reloading. If it keeps happening, the details are in the browser
                console.
              </p>
            </div>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      </div>
    )
  }
}
