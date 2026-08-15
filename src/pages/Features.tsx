import { useAuth } from '../auth/AuthContext'
import EntityTable from '../components/EntityTable'
import EntityFilters, { useEntityFilters } from '../components/EntityFilters'
import EntityForm from '../components/EntityForm'
import LoadError from '../components/LoadError'
import Toast from '../components/Toast'
import { entities } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import { useEntityEditor } from '../hooks/useEntityEditor'
import { canWriteRecords } from '../lib/permissions'
import { downloadCsv } from '../lib/csv'
import { applyFilters } from '../lib/filters'

const FEATURE = entities.feature

export default function Features() {
  const { state } = useAuth()
  const { features, vocabularies, openActionCounts, loading, error, loadedAt, refresh } =
    useTracker()
  const editor = useEntityEditor(FEATURE)
  const filters = useEntityFilters(FEATURE)

  // Filters narrow before the table's own free-text search, so the "N of M"
  // count below reads against the filtered slice rather than all 108.
  const visible = applyFilters(features, filters.values)

  if (state.status !== 'ready') return null
  const canWrite = canWriteRecords(state.user.role)

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Features</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'}
            {!canWrite && ' · read-only'}
          </p>
        </div>
        <div className="row row--tight">
          <button
            className="btn"
            onClick={() => downloadCsv(FEATURE, visible)}
            disabled={visible.length === 0}
          >
            Export CSV
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {canWrite && (
            <button className="btn btn--primary" onClick={() => editor.setEditing({ mode: 'new' })}>
              New feature
            </button>
          )}
        </div>
      </div>

      <EntityFilters
        entity={FEATURE}
        vocabularies={vocabularies}
        values={filters.values}
        onChange={filters.setValue}
        onClear={filters.clear}
      />

      {error && <LoadError error={error} />}
      <Toast message={editor.toast} onDismiss={() => editor.setToast(null)} />

      {loading && features.length === 0 && !error && (
        <div className="skeleton" aria-label="Loading features">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton__row" />
          ))}
        </div>
      )}

      {!error && (features.length > 0 || !loading) && (
        <EntityTable
          entity={FEATURE}
          records={visible}
          vocabularies={vocabularies}
          rowHref={(record) => `/features/${encodeURIComponent(record.id)}`}
          derived={[
            {
              key: 'openActions',
              label: 'Open Actions',
              // Computed here rather than stored, so it can never be written
              // back to the sheet and overwritten by the next row edit.
              value: (record) => openActionCounts.get(record.id) ?? 0,
            },
          ]}
          canWrite={canWrite}
          onEdit={(record) => editor.setEditing({ mode: 'edit', record })}
          onDelete={(record) => void editor.destroy(record)}
        />
      )}

      {editor.editing && (
        <EntityForm
          entity={FEATURE}
          record={editor.editing.mode === 'edit' ? editor.editing.record : undefined}
          vocabularies={vocabularies}
          onCancel={editor.cancel}
          onSave={editor.save}
        />
      )}
    </section>
  )
}
