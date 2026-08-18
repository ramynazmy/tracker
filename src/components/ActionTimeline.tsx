import { useState } from 'react'
import { Link } from 'react-router-dom'
import NotesBubble from './NotesBubble'
import { entities } from '../config/schema'
import { dueTone, isOwnedAction } from '../lib/rollups'
import { groupByMonth, monthLabel, type TimelineEntry } from '../lib/timeline'
import { labelFor, type Vocabularies } from '../sheets/lists'
import type { TrackerRecord } from '../sheets/rows'

const ACTION = entities.action

interface Props {
  /** Dated moments, already built by `buildTimeline` — newest first. */
  entries: readonly TimelineEntry[]
  /**
   * Rows carrying no valid date, shown in their own group at the end. The
   * feature page passes these so switching its list to this view never makes
   * an action silently disappear; the Timeline page deliberately does not.
   */
  undated?: readonly TrackerRecord[]
  vocabularies: Vocabularies
  featureNames: ReadonlyMap<string, string>
  ownedActors: ReadonlySet<string>
  today: string
  /** Off on a feature's own page, where every row names the same feature. */
  showFeature?: boolean
  /** Only passed for writers — absent, the buttons are omitted entirely. */
  onEdit?: (record: TrackerRecord) => void
  onDelete?: (record: TrackerRecord) => void
  emptyMessage?: string
}

/**
 * The timeline rendering shared by the Timeline page and a feature's detail
 * page: month groups, newest first, each dated moment on the spine.
 *
 * An action appears once per date it carries, so one with both a start and a
 * due date shows twice — that is correct, they are two different moments. The
 * edit and delete buttons therefore also appear on each occurrence; both act
 * on the one underlying record.
 */
export default function ActionTimeline({
  entries,
  undated = [],
  vocabularies,
  featureNames,
  ownedActors,
  today,
  showFeature = true,
  onEdit,
  onDelete,
  emptyMessage,
}: Props) {
  // The notes bubble: one open at most, anchored where the click landed.
  const [bubble, setBubble] = useState<{ action: TrackerRecord; x: number; y: number } | null>(
    null,
  )

  if (entries.length === 0 && undated.length === 0) {
    return emptyMessage ? <p className="muted">{emptyMessage}</p> : null
  }

  const body = (action: TrackerRecord, kindLabel: string, overdue: boolean) => (
    <div
      className="tl__body tl__body--clickable"
      onClick={(event) => {
        // Links and buttons keep their own jobs — the bubble is the click's
        // meaning only on the entry's plain text.
        if ((event.target as HTMLElement).closest('a, button')) return
        setBubble({ action, x: event.clientX, y: event.clientY })
      }}
    >
      <p className="tl__title">
        <span className="tl__kind">{kindLabel}</span>{' '}
        {String(action.fields[ACTION.titleField] ?? '(untitled)')}
        {/* Never colour alone: overdue says so in words. */}
        {overdue && <span className="tl__flag">overdue</span>}
      </p>
      <p className="tl__meta muted">
        {showFeature && (
          <>
            <FeatureLink action={action} featureNames={featureNames} />
            {' · '}
          </>
        )}
        {action.fields.type && (
          <>{labelFor(vocabularies, 'actionType', String(action.fields.type))} · </>
        )}
        {action.fields.actor
          ? labelFor(vocabularies, 'actor', String(action.fields.actor))
          : 'Architecture'}
        {/* The status in words, because the due date's tone alone must never
            be the only way to tell done from still-open. */}
        {action.fields.status && (
          <> · {labelFor(vocabularies, 'actionStatus', String(action.fields.status))}</>
        )}
        {onEdit && (
          <>
            {' · '}
            <button className="btn btn--link" onClick={() => onEdit(action)}>
              Edit
            </button>
          </>
        )}
        {onDelete && (
          <button
            className="btn btn--link btn--danger"
            onClick={() => onDelete(action)}
            title="Soft delete — the row is kept in the sheet"
          >
            Delete
          </button>
        )}
      </p>
    </div>
  )

  return (
    <>
      {groupByMonth(entries).map((month) => (
        <div key={month.month} className="tl-month">
          <h2 className="tl-month__label">{monthLabel(month.month)}</h2>
          <ol className="tl">
            {month.entries.map((entry) => {
              // "Overdue" is a statement about work WE owe. An event —
              // somebody else's milestone, saved with no status — would
              // otherwise read as overdue the day after it happens, because
              // a blank status counts as open.
              const ours = isOwnedAction(entry.action, ownedActors)
              const overdue = entry.overdue && ours
              // Only the DUE line wears the action's traffic light. A
              // "Started" line states history and stays in plain ink — as
              // does an event.
              const tone =
                entry.kind === 'due' ? dueTone(entry.action, today, ownedActors) : null
              return (
                <li
                  key={entry.key}
                  className={`tl__item${entry.past ? '' : ' tl__item--future'}${
                    tone ? ` tl__item--${tone}` : ''
                  }`}
                >
                  <time className="tl__date" dateTime={entry.date}>
                    {entry.date}
                  </time>
                  {/* Shape carries past-vs-future, not colour alone. */}
                  <span
                    className={`tl__dot${entry.past ? '' : ' tl__dot--hollow'}${
                      overdue ? ' tl__dot--overdue' : ''
                    }`}
                    aria-hidden
                  />
                  {body(
                    entry.action,
                    !ours ? 'Event' : entry.kind === 'raised' ? 'Started' : 'Due',
                    overdue,
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      ))}

      {undated.length > 0 && (
        <div className="tl-month">
          <h2 className="tl-month__label">No date</h2>
          <ol className="tl">
            {undated.map((action) => {
              const tone = dueTone(action, today, ownedActors)
              return (
              <li
                key={action.id}
                className={`tl__item tl__item--future${tone ? ` tl__item--${tone}` : ''}`}
              >
                <span className="tl__date">—</span>
                <span className="tl__dot tl__dot--hollow" aria-hidden />
                {body(
                  action,
                  isOwnedAction(action, ownedActors) ? 'Action' : 'Event',
                  false,
                )}
              </li>
              )
            })}
          </ol>
        </div>
      )}

      {bubble && (
        <NotesBubble
          title={String(bubble.action.fields[ACTION.titleField] ?? '(untitled)')}
          notes={String(bubble.action.fields.notes ?? '')}
          anchor={bubble}
          onClose={() => setBubble(null)}
        />
      )}
    </>
  )
}

function FeatureLink({
  action,
  featureNames,
}: {
  action: TrackerRecord
  featureNames: ReadonlyMap<string, string>
}) {
  const id = String(action.fields.featureId ?? '')
  const name = featureNames.get(id)
  if (!name) return <span className="chip chip--unknown">Unknown feature</span>
  return <Link to={`/features/${encodeURIComponent(id)}`}>{name}</Link>
}
