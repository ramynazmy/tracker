import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import EntityTable from '../components/EntityTable'
import EntityForm from '../components/EntityForm'
import LoadError from '../components/LoadError'
import Toast from '../components/Toast'
import { entities } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import { useEntityEditor } from '../hooks/useEntityEditor'
import { canWriteRecords } from '../lib/permissions'
import { actionsForFeature, isOpenAction } from '../lib/rollups'
import { labelFor } from '../sheets/lists'

const FEATURE = entities.feature
const ACTION = entities.action

export default function FeatureDetail() {
  const { id = '' } = useParams()
  const featureId = decodeURIComponent(id)

  const { state } = useAuth()
  const { features, actions, vocabularies, featureNames, loading, error } = useTracker()
  const editor = useEntityEditor(ACTION)

  const feature = features.find((f) => f.id === featureId)
  const own = useMemo(() => actionsForFeature(actions, featureId), [actions, featureId])

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

  const openCount = own.filter(isOpenAction).length

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
        {canWrite && (
          <div className="row row--tight">
            <button
              className="btn btn--primary"
              // featureId is locked, not merely pre-filled: an action created
              // from this page belongs to this feature, and letting it be
              // changed here would silently move it somewhere the user cannot
              // see.
              onClick={() => editor.setEditing({ mode: 'new', locked: { featureId } })}
            >
              New action
            </button>
          </div>
        )}
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

      <EntityTable
        entity={ACTION}
        records={own}
        vocabularies={vocabularies}
        linkLabels={featureNames}
        canWrite={canWrite}
        onEdit={(record) => editor.setEditing({ mode: 'edit', record })}
        onDelete={(record) => void editor.destroy(record)}
        emptyMessage="No actions raised against this feature."
      />

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
          locked={editor.editing.mode === 'new' ? editor.editing.locked : undefined}
          onCancel={editor.cancel}
          onSave={editor.save}
        />
      )}
    </section>
  )
}
