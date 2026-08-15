import { useAuth } from '../auth/AuthContext'

export default function ErrorScreen({ message }: { message: string }) {
  const { retry, signOut } = useAuth()

  return (
    <section className="centered">
      <h1>Something went wrong</h1>
      <div className="card card--warn">
        <p>{message}</p>
      </div>
      <div className="row">
        <button className="btn btn--primary" onClick={() => void retry()}>
          Try again
        </button>
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </section>
  )
}
