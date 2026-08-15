import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { type ListKind } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import LoadError from '../components/LoadError'
import { countBy, daysOverdue, isOpenAction, isOwnedAction } from '../lib/rollups'
import { labelFor, vocabularyOf, type Vocabularies } from '../sheets/lists'
import type { TrackerRecord } from '../sheets/rows'

/**
 * The workbook's Dashboard tab, computed in the client.
 *
 * Every number here is derived from the data the provider already holds, so the
 * page costs zero extra reads — and nothing here is ever written back. The
 * workbook did these with COUNTIF formulas living in cells; a formula in an
 * entity tab would be destroyed by the next row write.
 */
export default function Dashboard() {
  const { features, actions, vocabularies, ownedActors, loading, error, loadedAt } =
    useTracker()

  const stats = useMemo(() => {
    const status = countBy(features, 'status')
    const done = status.get('done') ?? 0
    // Ours only: the headline "open" and "overdue" figures are a statement
    // about this team's workload, not about everything on the timeline.
    const open = actions.filter((a) => isOpenAction(a) && isOwnedAction(a, ownedActors))
    const today = new Date()

    return {
      total: features.length,
      done,
      inProgress: status.get('in-progress') ?? 0,
      notStarted: status.get('not-started') ?? 0,
      percent: features.length === 0 ? 0 : Math.round((done / features.length) * 100),
      openActions: open.length,
      overdue: open.filter((a) => daysOverdue(a, today) !== null).length,
      asdRequired: features.filter((f) => String(f.fields.asdRequired) === 'yes').length,
    }
  }, [features, actions, ownedActors])

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  return (
    // Hold the previous render at reduced opacity on refetch rather than
    // flashing a skeleton, which would jump the layout.
    <section className={loading && features.length > 0 ? 'is-refetching' : undefined}>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'}
          </p>
        </div>
      </div>

      {/* Hero: the one number the view leads with. Exactly one per page. */}
      <div className="hero">
        <p className="hero__value">{stats.percent}%</p>
        <p className="hero__label">
          complete — {stats.done} of {stats.total} features done
        </p>
        <div className="meter" role="img" aria-label={`${stats.percent} percent complete`}>
          <div className="meter__fill" style={{ width: `${stats.percent}%` }} />
        </div>
      </div>

      <div className="kpis">
        <Stat label="Features" value={stats.total} />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="Not started" value={stats.notStarted} />
        <Stat label="ASD required" value={stats.asdRequired} />
        <Stat label="Open on us" value={stats.openActions} to="/actions" />
        <Stat label="Overdue" value={stats.overdue} to="/actions" warn={stats.overdue > 0} />
      </div>

      <div className="panels">
        <Breakdown
          title="By status"
          records={features}
          field="status"
          kind="featureStatus"
          vocabularies={vocabularies}
        />
        <Breakdown
          title="By channel"
          records={features}
          field="channel"
          kind="channel"
          vocabularies={vocabularies}
        />
        <Breakdown
          title="By owner"
          records={features}
          field="owner"
          kind="owner"
          vocabularies={vocabularies}
        />
        <Breakdown
          title="Actions by type"
          records={actions}
          field="type"
          kind="actionType"
          vocabularies={vocabularies}
          note="What kind of architecture work is being asked of us"
        />
        <Breakdown
          title="ASD status"
          records={features.filter((f) => String(f.fields.asdRequired) === 'yes')}
          field="asdStatus"
          kind="asdStatus"
          vocabularies={vocabularies}
          note="Features where an ASD is required"
        />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  to,
  warn,
}: {
  label: string
  value: number
  to?: string
  warn?: boolean
}) {
  const body = (
    <>
      {/* Proportional figures, not tabular-nums: equal-width digits make a
          number like 121 look loose at display sizes. */}
      <span className="stat__value">{value.toLocaleString()}</span>
      <span className="stat__label">{label}</span>
    </>
  )
  const className = warn ? 'stat stat--warn' : 'stat'
  return to ? (
    <Link className={className} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/**
 * A magnitude comparison within one dimension.
 *
 * One hue for every bar, deliberately — the categories here have no natural
 * order, and shading them by size would double-encode the bar length as colour
 * while burning the only free channel. Identity comes from the row label.
 */
function Breakdown({
  title,
  records,
  field,
  kind,
  vocabularies,
  note,
}: {
  title: string
  records: TrackerRecord[]
  field: string
  kind: ListKind
  vocabularies: Vocabularies
  note?: string
}) {
  const rows = useMemo(() => {
    const counts = countBy(records, field)
    // Vocabulary order, so the statuses read as a workflow rather than
    // alphabetically and the order stays stable as counts change.
    const ordered = vocabularyOf(vocabularies, kind).active.map((item) => ({
      id: item.id,
      label: item.label,
      count: counts.get(item.id) ?? 0,
    }))

    // Anything stored but not in the vocabulary, so nothing is silently dropped.
    for (const [id, count] of counts) {
      if (id && !ordered.some((r) => r.id === id)) {
        ordered.push({ id, label: labelFor(vocabularies, kind, id), count })
      }
    }
    const blank = counts.get('') ?? 0
    if (blank) ordered.push({ id: '', label: 'Not set', count: blank })

    return ordered
  }, [records, field, kind, vocabularies])

  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <section className="panel">
      <h2 className="panel__title">{title}</h2>
      {note && <p className="panel__note muted">{note}</p>}
      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <dl className="bars">
          {rows.map((row) => (
            <div key={row.id || '(blank)'} className="bar">
              <dt className="bar__label">{row.label}</dt>
              <div className="bar__track">
                {/* Bars grow from one baseline and are scaled to the largest
                    value in this panel, so the comparison is within-dimension. */}
                <div className="bar__fill" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
              <dd className="bar__value">{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
