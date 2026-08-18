import { useMemo } from 'react'
import LoadError from '../components/LoadError'
import {
  Breakdown,
  ChannelCard,
  Stat,
  buildChannelView,
} from '../components/DashboardPanels'
import { useTracker } from '../data/TrackerDataContext'
import { ACTIVE_WINDOW_DAYS, recentActivity } from '../lib/activity'
import {
  daysOverdue,
  inProgressFeatureIds,
  isOpenAction,
  isOwnedAction,
} from '../lib/rollups'

/**
 * The workbook's Dashboard tab, computed in the client.
 *
 * This is a view of work IN FLIGHT, not of the whole book: a feature appears
 * only when it has started AND something says it is moving — a dated moment
 * inside the activity window, or an action currently in progress. Everything
 * below the hero (the KPI tiles, the channel cards, the breakdowns) is
 * computed from that same slice, so the counters count exactly what the cards
 * show. The full unfiltered book lives on the Features page; the tracked
 * slice for meetings lives on the Management page.
 *
 * Every number here is derived from the data the provider already holds, so
 * the page costs zero extra reads — and nothing here is ever written back.
 */
export default function Dashboard() {
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

  /**
   * The features this page is about. Three gates, all deliberate:
   *  - not-started features are backlog ("just in plan") and never shown;
   *  - a dated moment in the last ACTIVE_WINDOW_DAYS qualifies (events
   *    included — a milestone landing is movement);
   *  - an action in progress qualifies even with no recent date, so slow
   *    work being actively done does not fall off the board.
   */
  const active = useMemo(() => {
    const moved = new Set(recentActivity(actions, today).map((a) => a.featureId))
    const working = inProgressFeatureIds(actions)
    return features.filter((f) => {
      if (String(f.fields.status ?? '') === 'not-started') return false
      return moved.has(f.id) || working.has(f.id)
    })
  }, [features, actions, today])

  const stats = useMemo(() => {
    const activeIds = new Set(active.map((f) => f.id))
    // Ours only, and only on the features this page shows: the figures are a
    // statement about this team's workload on the work in flight.
    const open = actions.filter(
      (a) =>
        isOpenAction(a) &&
        isOwnedAction(a, ownedActors) &&
        activeIds.has(String(a.fields.featureId ?? '')),
    )
    const now = new Date()

    return {
      total: features.length,
      done: features.filter((f) => String(f.fields.status ?? '') === 'done').length,
      active: active.length,
      inProgress: active.filter((f) => String(f.fields.status ?? '') === 'in-progress').length,
      asdRequired: active.filter((f) => String(f.fields.asdRequired) === 'yes').length,
      openActions: open.length,
      overdue: open.filter((a) => daysOverdue(a, now) !== null).length,
    }
  }, [features, active, actions, ownedActors])

  // Programme-wide on purpose, unlike everything below it: "percent complete"
  // over only the active slice would hover near zero forever, because a done
  // feature stops being active. The sentence states its own basis, so the two
  // scopes cannot be confused.
  const percent =
    stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100)

  // Actions belonging to the features on show, for the by-type breakdown.
  const activeActions = useMemo(() => {
    const activeIds = new Set(active.map((f) => f.id))
    return actions.filter((a) => activeIds.has(String(a.fields.featureId ?? '')))
  }, [active, actions])

  const channels = useMemo(
    () => buildChannelView(active, actions, ownedActors, vocabularies, today),
    [active, actions, ownedActors, vocabularies, today],
  )

  // The same number the cards add up to, so the hero and the cards can never
  // disagree — it is derived from the same call, not counted a second way.
  const activeTotal = useMemo(
    () => channels.reduce((n, c) => n + c.active.length, 0),
    [channels],
  )

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
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'} · showing work
            active in the last {ACTIVE_WINDOW_DAYS} days or in progress
          </p>
        </div>
      </div>

      {/* Hero: the one number the view leads with. Exactly one per page. */}
      <div className="hero">
        <p className="hero__value">{percent}%</p>
        <p className="hero__label">
          complete — {stats.done} of {stats.total} features done
        </p>
        <div className="meter" role="img" aria-label={`${percent} percent complete`}>
          <div className="meter__fill" style={{ width: `${percent}%` }} />
        </div>
        {activeTotal > 0 && (
          <p className="hero__live">
            {activeTotal} {activeTotal === 1 ? 'feature has' : 'features have'} moved in the last{' '}
            {ACTIVE_WINDOW_DAYS} days
          </p>
        )}
      </div>

      <div className="kpis">
        <Stat label="Active features" value={stats.active} />
        <Stat label="In progress" value={stats.inProgress} />
        <Stat label="ASD required" value={stats.asdRequired} />
        <Stat label="Open on us" value={stats.openActions} to="/actions" />
        <Stat label="Overdue" value={stats.overdue} to="/actions" warn={stats.overdue > 0} />
      </div>

      <h2 className="section-title">Channels</h2>
      {channels.length === 0 ? (
        <p className="muted">
          Nothing is moving: no feature has a dated moment in the last {ACTIVE_WINDOW_DAYS} days
          or an action in progress. The full list is on the Features page.
        </p>
      ) : (
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
      )}

      <div className="panels">
        <Breakdown
          title="By status"
          to="/features"
          records={active}
          field="status"
          kind="featureStatus"
          vocabularies={vocabularies}
          note="Active features only"
        />
        <Breakdown
          title="By owner"
          to="/features"
          records={active}
          field="owner"
          kind="owner"
          vocabularies={vocabularies}
          note="Active features only"
        />
        <Breakdown
          title="Actions by type"
          to="/actions"
          records={activeActions}
          field="type"
          kind="actionType"
          vocabularies={vocabularies}
          note="What kind of architecture work is being asked of us, on active features"
        />
        <Breakdown
          title="ASD status"
          to="/features"
          records={active.filter((f) => String(f.fields.asdRequired) === 'yes')}
          field="asdStatus"
          kind="asdStatus"
          vocabularies={vocabularies}
          note="Active features where an ASD is required"
        />
      </div>
    </section>
  )
}
