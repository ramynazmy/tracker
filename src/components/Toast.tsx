export default function Toast({
  message,
  onDismiss,
}: {
  message: string | null
  onDismiss: () => void
}) {
  if (!message) return null
  return (
    <div className="card card--warn">
      <p>{message}</p>
      <button className="btn btn--link" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
