import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import LoadError from '../components/LoadError'
import {
  Breakdown,
  ChannelCard,
  Stat,
  buildChannelView,
} from '../components/DashboardPanels'
import { useTracker } from '../data/TrackerDataContext'
import {
  daysOverdue,
  isOpenAction,
  isOwnedAction,
} from '../lib/rollups'

/**
 * Meeting prep: only the features flagged `Tracked by Management`.
 *
 * Same shapes as the Dashboard — counters, channel cards, breakdowns — over a
 * different slice. Deliberately NOT the dashboard's activity filter: this page
 * answers "where does everything management asked about stand", and a tracked
 * feature that has not moved in a month is precisely the thing to know about
 * before the meeting, so nothing here is hidden for being quiet. The flag
 * itself is a column on the feature, edited from the feature's form.
 */
export default function Management() {
  const {
    features,
    actions,
    vocabularies,
    ownedActors,
    loading,
    error,
    loadedAt,
  } = useTracker()

  const today = new Date().toISOString().slice(0, 10)

  const tracked = useMemo(
    () =>
      features.filter(
        (f) => String(f.fields.trackedByManagement ?? '').trim().toLowerCase() === 'yes',
      ),
    [features],
  )

  const stats = useMemo(() => {
    const trackedIds = new Set(tracked.map((f) => f.id))
    const open = actions.filter(
      (a) =>
        isOpenAction(a) &&
        isOwnedAction(a, ownedActors) &&
        trackedIds.has(String(a.fields.featureId ?? '')),
    )
    const now = new Date()

    return {
      total: tracked.length,
      done: tracked.filter((f) => String(f.fields.status ?? '') === 'done').length,
      inProgress: tracked.filter((f) => String(f.fields.status ?? '') === 'in-progress').length,
      notStarted: tracked.filter((f) => String(f.fields.status ?? '') === 'not-started').length,
      openActions: open.length,
      overdue: open.filter((a) => daysOverdue(a, now) !== null).length,
    }
  }, [tracked, actions, ownedActors])

  const percent = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100)

  const channels = useMemo(
    () => buildChannelView(tracked, actions, ownedActors, vocabularies, today),
    [tracked, actions, ownedActors, vocabularies, today],
  )

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  return (
    <section className={loading && features.length > 0 ? 'is-refetching' : undefined}>
      <div className="page-head">
        <div>
          <h1>Management 😄</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'} · features tracked
            by management, for meetings and updates
          </p>
        </div>
      </div>

      {tracked.length === 0 && !loading ? (
        <div className="card">
          <strong>Nothing is tracked yet</strong>
          <p className="muted">
            Open a feature and set <em>Tracked by Management</em> to <em>yes</em> — it appears
            here on the next load. <Link to="/features">Go to features</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="hero">
            <p className="hero__value">{percent}%</p>
            <p className="hero__label">
              complete — {stats.done} of {stats.total} tracked features done
            </p>
            <div className="meter" role="img" aria-label={`${percent} percent complete`}>
              <div className="meter__fill" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="kpis">
            <Stat label="Tracked features" value={stats.total} />
            <Stat label="In progress" value={stats.inProgress} />
            {/* Shown here, unlike the dashboard: a tracked feature that has
                not started is exactly what a management update must not miss. */}
            <Stat label="Not started" value={stats.notStarted} />
            <Stat label="Open on us" value={stats.openActions} to="/actions" />
            <Stat label="Overdue" value={stats.overdue} to="/actions" warn={stats.overdue > 0} />
          </div>

          <h2 className="section-title">Channels</h2>
          <div className="channels">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id || '(none)'}
                channelId={channel.id}
                releases={channel.releases}
                active={channel.active}
                vocabularies={vocabularies}
              />
            ))}
          </div>

          <div className="panels">
            <Breakdown
              title="By status"
              to="/features"
              records={tracked}
              field="status"
              kind="featureStatus"
              vocabularies={vocabularies}
              note="Tracked features only"
            />
            <Breakdown
              title="By owner"
              to="/features"
              records={tracked}
              field="owner"
              kind="owner"
              vocabularies={vocabularies}
              note="Tracked features only"
            />
          </div>
        </>
      )}
    </section>
  )
}
