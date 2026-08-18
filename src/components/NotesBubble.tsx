import { useEffect, useRef } from 'react'

interface Props {
  title: string
  notes: string
  /** Viewport coordinates of the click that opened it — `position: fixed`. */
  anchor: { x: number; y: number }
  onClose: () => void
}

/* Match the CSS width and max height, so the clamp keeps it on screen. */
const WIDTH = 360
const HEIGHT = 330

/**
 * A small popover showing an action's notes, opened by clicking the row or
 * timeline entry and dismissed by clicking anywhere else or pressing Escape.
 *
 * Not a dialog like EntityForm's backdrop: a backdrop would swallow the next
 * click, so moving between actions would take two clicks each. Instead a
 * document-level listener closes it on any press outside the bubble — on
 * `mousedown`, not `click`, so it is gone before whatever the click does
 * next (including opening the bubble for another row).
 */
export default function NotesBubble({ title, notes, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(anchor.y + 10, window.innerHeight - HEIGHT - 8))

  return (
    <div
      ref={ref}
      className="notes-bubble"
      role="dialog"
      aria-label={`Notes — ${title}`}
      style={{ left, top }}
    >
      <p className="notes-bubble__title">{title}</p>
      {notes.trim() ? (
        <p className="notes-bubble__text">{notes}</p>
      ) : (
        <p className="notes-bubble__text muted">No notes on this one.</p>
      )}
    </div>
  )
}
