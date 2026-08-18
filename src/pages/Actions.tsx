import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import EntityTable from '../components/EntityTable'
import NotesBubble from '../components/NotesBubble'
import EntityFilters, { useEntityFilters } from '../components/EntityFilters'
import EntityForm from '../components/EntityForm'
import LoadError from '../components/LoadError'
import Toast from '../components/Toast'
import { actionFormFields, entities, type ActionVariant } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import { useEntityEditor } from '../hooks/useEntityEditor'
import { canWriteRecords } from '../lib/permissions'
import { downloadCsv } from '../lib/csv'
import { applyFilters, filterableFields } from '../lib/filters'
import { daysOverdue, dueTone, isOpenAction, isOwnedAction, orphanActions } from '../lib/rollups'

const FEATURE = entities.feature
const ACTION = entities.action

type Filter = 'open' | 'all'

/**
 * "Ours" is not an actor, it is a set of them — which is why it cannot just be
 * another option value matched by string equality.
 */
const OURS = '!ours'

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
  // Which face of the form a NEW row gets. An existing row derives it from its
  // actor instead — see `variant` below — so this only matters between
  // pressing "New action"/"New event" and saving.
  const [newVariant, setNewVariant] = useState<ActionVariant>('action')
  // Open-first by default: this page is the workbook's "Open Tasks" view, and
  // the whole point of that tab was what still needs doing.
  const [filter, setFilter] = useState<Filter>('open')
  const filters = useEntityFilters(filterableFields(ACTION))
  // The notes bubble: one open at most, anchored where the click landed.
  const [bubble, setBubble] = useState<{
    record: (typeof actions)[number]
    x: number
    y: number
  } | null>(null)

  const orphans = useMemo(
    () => orphanActions(actions, new Set(features.map((f) => f.id))),
    [actions, features],
  )

  const visible = useMemo(() => {
    // "Open" means OUR open work. An event is somebody else's moment — its
    // blank status would otherwise count it as open forever — so it only
    // appears under "Show all".
    let rows =
      filter === 'open'
        ? actions.filter((a) => isOpenAction(a) && isOwnedAction(a, ownedActors))
        : actions

    // "Ours" spans however many actors the sheet marks as owned, so it is
    // resolved here rather than by the generic equality match.
    const { actor, ...rest } = filters.values
    if (actor === OURS) rows = rows.filter((a) => isOwnedAction(a, ownedActors))

    return applyFilters(rows, actor === OURS ? rest : filters.values)
  }, [actions, filter, filters.values, ownedActors])

  if (state.status !== 'ready') return null
  const canWrite = canWriteRecords(state.user.role)
  const today = new Date()
  // UTC, matching every other date comparison in the app.
  const todayIso = today.toISOString().slice(0, 10)

  // A row someone else performs IS an event — same rule as every rollup — so
  // editing one reopens the event face of the form, not the action face.
  const variant: ActionVariant =
    editor.editing?.mode === 'edit'
      ? isOwnedAction(editor.editing.record, ownedActors)
        ? 'action'
        : 'event'
      : newVariant

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
            <>
              <button
                className="btn"
                onClick={() => {
                  setNewVariant('event')
                  editor.setEditing({ mode: 'new' })
                }}
              >
                New event
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setNewVariant('action')
                  editor.setEditing({ mode: 'new' })
                }}
              >
                New action
              </button>
            </>
          )}
        </div>
      </div>

      <EntityFilters
        fields={filterableFields(ACTION)}
        vocabularies={vocabularies}
        values={filters.values}
        onChange={filters.setValue}
        onClear={filters.clear}
        extraOptions={{ actor: [{ value: OURS, label: 'Ours only' }] }}
      />

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
              // An event cannot be overdue — nobody here owes it.
              value: (record) =>
                isOwnedAction(record, ownedActors) ? daysOverdue(record, today) : null,
            },
          ]}
          rowClass={(record) => {
            const tone = dueTone(record, todayIso, ownedActors)
            return tone ? `due--${tone}` : undefined
          }}
          onRowClick={(record, event) =>
            setBubble({ record, x: event.clientX, y: event.clientY })
          }
          canWrite={canWrite}
          onEdit={(record) => editor.setEditing({ mode: 'edit', record })}
          onDelete={(record) => void editor.destroy(record)}
          emptyMessage={
            filter === 'open' ? 'Nothing open — everything is done or cancelled.' : 'No actions yet.'
          }
        />
      )}

      {bubble && (
        <NotesBubble
          title={String(bubble.record.fields[ACTION.titleField] ?? '(untitled)')}
          notes={String(bubble.record.fields.notes ?? '')}
          anchor={bubble}
          onClose={() => setBubble(null)}
        />
      )}

      {editor.editing && (
        <EntityForm
          entity={ACTION}
          record={editor.editing.mode === 'edit' ? editor.editing.record : undefined}
          fields={actionFormFields(variant)}
          title={`${editor.editing.mode === 'edit' ? 'Edit' : 'New'} ${variant}`}
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
