import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import ActionTimeline from '../components/ActionTimeline'
import EntityForm from '../components/EntityForm'
import LoadError from '../components/LoadError'
import Toast from '../components/Toast'
import { actionFormFields, entities, type ActionVariant } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import { useEntityEditor } from '../hooks/useEntityEditor'
import { canWriteRecords } from '../lib/permissions'
import { actionsForFeature, isOpenAction, isOwnedAction } from '../lib/rollups'
import { buildTimeline } from '../lib/timeline'
import { labelFor } from '../sheets/lists'

const FEATURE = entities.feature
const ACTION = entities.action

export default function FeatureDetail() {
  const { id = '' } = useParams()
  const featureId = decodeURIComponent(id)

  const { state } = useAuth()
  const { features, actions, vocabularies, featureNames, ownedActors, loading, error } =
    useTracker()
  const editor = useEntityEditor(ACTION)
  // A second editor rather than a mode on the first: the two forms write
  // different entities, and sharing one editor would point a save at the
  // wrong tab.
  const featureEditor = useEntityEditor(FEATURE)
  const [newVariant, setNewVariant] = useState<ActionVariant>('action')

  const feature = features.find((f) => f.id === featureId)
  const own = useMemo(() => actionsForFeature(actions, featureId), [actions, featureId])

  // UTC, matching every other date comparison in the app.
  const todayIso = new Date().toISOString().slice(0, 10)
  const entries = useMemo(() => buildTimeline(own, todayIso), [own, todayIso])
  // Anything the timeline's date parsing skipped still gets listed — a view
  // change must never make an action disappear.
  const undated = useMemo(() => {
    const dated = new Set(entries.map((e) => e.action.id))
    return own.filter((a) => !dated.has(a.id))
  }, [own, entries])

  if (state.status !== 'ready') return null
  const canWrite = canWriteRecords(state.user.role)

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  if (!feature) {
    return (
      <section>
        <div className="card card--warn">
          <strong>{loading ? 'Loading…' : 'That feature is not in the sheet'}</strong>
          {!loading && (
            <p className="muted">
              It may have been deleted, or the link may be stale.{' '}
              <Link to="/features">Back to features</Link>
            </p>
          )}
        </div>
      </section>
    )
  }

  // Ours only, like every rollup: an event is not open work we owe.
  const openCount = own.filter(
    (a) => isOpenAction(a) && isOwnedAction(a, ownedActors),
  ).length

  // Same rule as every rollup: performed by someone else = event.
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
          <p className="muted">
            <Link to="/features">← Features</Link>
          </p>
          <h1>{String(feature.fields[FEATURE.titleField] ?? '(unnamed)')}</h1>
          <p className="muted">
            {own.length} action{own.length === 1 ? '' : 's'} · {openCount} open
          </p>
        </div>
        <div className="row row--tight">
          {/* A link, not a button: it navigates, so middle-click and
              copy-link-address must keep working. Outside the canWrite guard —
              reading a chronology is not a write. */}
          <Link className="btn" to={`/timeline?feature=${encodeURIComponent(featureId)}`}>
            Timeline
          </Link>
          {canWrite && (
            <>
            <button
              className="btn"
              onClick={() => featureEditor.setEditing({ mode: 'edit', record: feature })}
            >
              Edit feature
            </button>
            <button
              className="btn"
              onClick={() => {
                setNewVariant('event')
                editor.setEditing({ mode: 'new', locked: { featureId } })
              }}
            >
              New event
            </button>
            <button
              className="btn btn--primary"
              // featureId is locked, not merely pre-filled: an action created
              // from this page belongs to this feature, and letting it be
              // changed here would silently move it somewhere the user cannot
              // see.
              onClick={() => {
                setNewVariant('action')
                editor.setEditing({ mode: 'new', locked: { featureId } })
              }}
            >
              New action
            </button>
            </>
          )}
        </div>
      </div>

      <dl className="detail-grid">
        {FEATURE.fields
          .filter((field) => field.key !== FEATURE.titleField && field.type !== 'longtext')
          .map((field) => {
            const raw = feature.fields[field.key]
            const text = raw === null || raw === undefined || raw === '' ? null : String(raw)
            return (
              <div key={field.key} className="detail-grid__pair">
                <dt>{field.label}</dt>
                <dd>
                  {text === null ? (
                    <span className="muted">—</span>
                  ) : field.type === 'reference' && field.listKind ? (
                    labelFor(vocabularies, field.listKind, text)
                  ) : (
                    text
                  )}
                </dd>
              </div>
            )
          })}
      </dl>

      {feature.fields.notes && <p className="detail-notes">{String(feature.fields.notes)}</p>}

      <h2>Actions</h2>
      <Toast message={editor.toast} onDismiss={() => editor.setToast(null)} />
      <Toast message={featureEditor.toast} onDismiss={() => featureEditor.setToast(null)} />

      <ActionTimeline
        entries={entries}
        undated={undated}
        vocabularies={vocabularies}
        featureNames={featureNames}
        ownedActors={ownedActors}
        today={todayIso}
        showFeature={false}
        onEdit={canWrite ? (record) => editor.setEditing({ mode: 'edit', record }) : undefined}
        onDelete={canWrite ? (record) => void editor.destroy(record) : undefined}
        emptyMessage="No actions raised against this feature."
      />

      {featureEditor.editing?.mode === 'edit' && (
        <EntityForm
          entity={FEATURE}
          record={featureEditor.editing.record}
          vocabularies={vocabularies}
          onCancel={featureEditor.cancel}
          onSave={featureEditor.save}
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
          locked={editor.editing.mode === 'new' ? editor.editing.locked : undefined}
          onCancel={editor.cancel}
          onSave={editor.save}
        />
      )}
    </section>
  )
}
