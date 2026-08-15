import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import EntityTable from '../components/EntityTable'
import EntityForm from '../components/EntityForm'
import LoadError from '../components/LoadError'
import Toast from '../components/Toast'
import { entities } from '../config/schema'
import { vocabularyOf } from '../sheets/lists'
import { useTracker } from '../data/TrackerDataContext'
import { useEntityEditor } from '../hooks/useEntityEditor'
import { canWriteRecords } from '../lib/permissions'
import { downloadCsv } from '../lib/csv'
import { daysOverdue, isOpenAction, isOwnedAction, orphanActions } from '../lib/rollups'

const FEATURE = entities.feature
const ACTION = entities.action

type Filter = 'open' | 'all'
/** '' = every actor. Otherwise a Lists actor id, or 'ours' for the team. */
type ActorFilter = string

export default function Actions() {
  const { state } = useAuth()
  const {
    features,
    actions,
    vocabularies,
    featureNames,
    ownedActors,
    loading,
    error,
    loadedAt,
    refresh,
  } = useTracker()
  const editor = useEntityEditor(ACTION)
  // Open-first by default: this page is the workbook's "Open Tasks" view, and
  // the whole point of that tab was what still needs doing.
  const [filter, setFilter] = useState<Filter>('open')
  const [actor, setActor] = useState<ActorFilter>('')

  const orphans = useMemo(
    () => orphanActions(actions, new Set(features.map((f) => f.id))),
    [actions, features],
  )

  const visible = useMemo(() => {
    let rows = filter === 'open' ? actions.filter(isOpenAction) : actions
    if (actor === 'ours') rows = rows.filter((a) => isOwnedAction(a, ownedActors))
    else if (actor) rows = rows.filter((a) => String(a.fields.actor ?? '') === actor)
    return rows
  }, [actions, filter, actor, ownedActors])

  const actorOptions = vocabularyOf(vocabularies, 'actor').active

  if (state.status !== 'ready') return null
  const canWrite = canWriteRecords(state.user.role)
  const today = new Date()

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Actions</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'}
            {!canWrite && ' · read-only'}
          </p>
        </div>
        <div className="row row--tight">
          <select
            className="input input--inline"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            aria-label="Filter by who does it"
          >
            <option value="">Everyone</option>
            <option value="ours">Ours only</option>
            {actorOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => setFilter((f) => (f === 'open' ? 'all' : 'open'))}
          >
            {filter === 'open' ? 'Show all' : 'Show open only'}
          </button>
          <button
            className="btn"
            onClick={() => downloadCsv(ACTION, visible)}
            disabled={visible.length === 0}
          >
            Export CSV
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {canWrite && features.length > 0 && (
            <button className="btn btn--primary" onClick={() => editor.setEditing({ mode: 'new' })}>
              New action
            </button>
          )}
        </div>
      </div>

      {error && <LoadError error={error} />}
      <Toast message={editor.toast} onDismiss={() => editor.setToast(null)} />

      {orphans.length > 0 && (
        <div className="card card--warn">
          <strong>
            {orphans.length} action{orphans.length === 1 ? '' : 's'} not linked to a feature
          </strong>
          <p className="muted">
            The feature was deleted, or the link was never set. Open each one and pick a feature —
            nothing is lost in the meantime.
          </p>
        </div>
      )}

      {!error && (actions.length > 0 || !loading) && (
        <EntityTable
          entity={ACTION}
          records={visible}
          vocabularies={vocabularies}
          linkLabels={featureNames}
          derived={[
            {
              key: 'daysOverdue',
              label: 'Days Overdue',
              value: (record) => daysOverdue(record, today),
            },
          ]}
          canWrite={canWrite}
          onEdit={(record) => editor.setEditing({ mode: 'edit', record })}
          onDelete={(record) => void editor.destroy(record)}
          emptyMessage={
            filter === 'open' ? 'Nothing open — everything is done or cancelled.' : 'No actions yet.'
          }
        />
      )}

      {editor.editing && (
        <EntityForm
          entity={ACTION}
          record={editor.editing.mode === 'edit' ? editor.editing.record : undefined}
          vocabularies={vocabularies}
          linkChoices={{
            featureId: features.map((f) => ({
              value: f.id,
              label: String(f.fields[FEATURE.titleField] ?? f.id),
            })),
          }}
          onCancel={editor.cancel}
          onSave={editor.save}
        />
      )}
    </section>
  )
}
