import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { type ListKind } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import LoadError from '../components/LoadError'
import { countBy, daysOverdue, isOpenAction, isOwnedAction } from '../lib/rollups'
import { ACTIVE_WINDOW_DAYS, recentActivity, type FeatureActivity } from '../lib/activity'
import { groupByRelease, sortGroups, type ReleaseGroup } from '../lib/releases'
import { labelFor, vocabularyOf, type Vocabularies } from '../sheets/lists'
import { NOT_SET } from '../lib/filters'
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

  const channels = useMemo(() => {
    const groups = sortGroups(
      groupByRelease(features, actions, ownedActors, new Date()),
      vocabularyOf(vocabularies, 'channel').active.map((i) => i.id),
      vocabularyOf(vocabularies, 'release').active.map((i) => i.id),
    )

    const activity = recentActivity(actions, today)
    const featureChannel = new Map(
      features.map((f) => [f.id, String(f.fields.channel ?? '')]),
    )

    const byChannel = new Map<string, { releases: ReleaseGroup[]; active: FeatureActivity[] }>()
    for (const group of groups) {
      const entry = byChannel.get(group.channel) ?? { releases: [], active: [] }
      entry.releases.push(group)
      byChannel.set(group.channel, entry)
    }
    for (const item of activity) {
      const channel = featureChannel.get(item.featureId)
      if (channel === undefined) continue
      byChannel.get(channel)?.active.push(item)
    }

    return [...byChannel.entries()].map(([id, value]) => ({ id, ...value }))
  }, [features, actions, ownedActors, vocabularies, today])

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
          records={features}
          field="status"
          kind="featureStatus"
          vocabularies={vocabularies}
        />
        <Breakdown
          title="By owner"
          to="/features"
          records={features}
          field="owner"
          kind="owner"
          vocabularies={vocabularies}
        />
        <Breakdown
          title="Actions by type"
          to="/actions"
          records={actions}
          field="type"
          kind="actionType"
          vocabularies={vocabularies}
          note="What kind of architecture work is being asked of us"
        />
        <Breakdown
          title="ASD status"
          to="/features"
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

/**
 * One channel: how its releases stand, and what has moved lately.
 *
 * The releases answer "where is the plan", the activity list answers "where is
 * the attention" — a release can be 0% and busy, or 80% and untouched for a
 * month, and only showing both distinguishes them.
 *
 * Three levels of disclosure, each with the affordance that fits it: the
 * channel is a card, a release is a disclosure you open, and a feature is a
 * button you press to go there. Collapsed, the card shows exactly what it
 * showed before — the expansion is additive, so the dashboard does not get
 * longer just because a channel has 35 features.
 */
/** A feature's recent activity plus where it sits in the channel's order. */
type RankedActivity = FeatureActivity & { rank: number }

function ChannelCard({
  channelId,
  releases,
  active,
  vocabularies,
}: {
  channelId: string
  releases: ReleaseGroup[]
  active: FeatureActivity[]
  vocabularies: Vocabularies
}) {
  const total = releases.reduce((n, r) => n + r.total, 0)
  const done = releases.reduce((n, r) => n + r.done, 0)
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  const channelLabel = channelId === '' ? 'No channel' : labelFor(vocabularies, 'channel', channelId)
  const channelHref = `/features?channel=${encodeURIComponent(channelId || NOT_SET)}`
  // Ranked, because the buttons sort by it: `recentActivity` already returns
  // most-recently-moved first, so the index IS the order to show them in.
  const activity = new Map<string, RankedActivity>(
    active.map((a, rank) => [a.featureId, { ...a, rank }]),
  )

  return (
    <section className="channel">
      <header className="channel__head">
        <h3 className="channel__name">
          <Link to={channelHref}>{channelLabel}</Link>
        </h3>
        <span className="muted">
          {total} {total === 1 ? 'feature' : 'features'} · {percent}%
        </span>
      </header>

      {/* The legend, not a second list: the features themselves now live in
          the releases below, so this line's only job is to decode the colour
          and give the channel-level count. */}
      <p className="channel__legend">
        {/* The swatch is rendered either way — its column is what lines the
            caption up with the release names below. */}
        <span
          className={
            active.length === 0
              ? 'channel__legend-swatch channel__legend-swatch--quiet'
              : 'channel__legend-swatch'
          }
          aria-hidden="true"
        />
        {active.length === 0 ? (
          <span className="muted">Nothing has moved in {ACTIVE_WINDOW_DAYS} days</span>
        ) : (
          <span>
            <strong>{active.length}</strong> active in the last {ACTIVE_WINDOW_DAYS} days
          </span>
        )}
      </p>

      <div className="channel__releases">
        {releases.map((release) => (
          <ReleaseRow
            key={release.release || '(none)'}
            release={release}
            activity={activity}
            vocabularies={vocabularies}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * One release, as a disclosure.
 *
 * Native `<details>` rather than a `useState` toggle: it brings its own
 * `aria-expanded`, its own keyboard handling, and it survives a re-render
 * without the dashboard having to hold per-release open state. The summary
 * carries the whole collapsed row, so nothing is hidden behind the click that
 * was visible before it.
 */
function ReleaseRow({
  release,
  activity,
  vocabularies,
}: {
  release: ReleaseGroup
  activity: ReadonlyMap<string, RankedActivity>
  vocabularies: Vocabularies
}) {
  const label =
    release.release === '' ? 'No release' : labelFor(vocabularies, 'release', release.release)
  const href =
    `/features?channel=${encodeURIComponent(release.channel || NOT_SET)}` +
    `&release=${encodeURIComponent(release.release || NOT_SET)}`

  // Moved-recently first, in the order they moved; everything else keeps its
  // existing order, because Array.prototype.sort is stable.
  const features = [...release.features].sort(
    (a, b) =>
      (activity.get(a.id)?.rank ?? Number.MAX_SAFE_INTEGER) -
      (activity.get(b.id)?.rank ?? Number.MAX_SAFE_INTEGER),
  )
  const liveCount = features.filter((f) => activity.has(f.id)).length

  return (
    <details className="rel">
      <summary className="rel__summary">
        <span className="rel__chevron" aria-hidden="true" />
        <span className="rel__name">{label}</span>
        <span className="meter meter--inline">
          <span className="meter__fill" style={{ width: `${release.percent}%` }} />
        </span>
        <span className="rel__count">
          {release.done}/{release.total}
        </span>
        <span className="rel__flags">
          {release.openActions > 0 && <span>{release.openActions} open</span>}
          {release.overdue > 0 && <span className="tl__flag">{release.overdue} overdue</span>}
          {/* Collapsed, this is the only thing saying where the attention is —
              without it, closing the accordion would hide the activity signal
              entirely rather than just its detail. */}
          {liveCount > 0 && <span className="rel__live">{liveCount} active</span>}
        </span>
      </summary>

      <div className="rel__body">
        <div className="feats">
          {features.map((feature) => (
            <FeatureButton
              key={feature.id}
              feature={feature}
              recent={activity.get(feature.id)}
              vocabularies={vocabularies}
            />
          ))}
        </div>
        <Link className="rel__all" to={href}>
          Open all {release.total} in Features →
        </Link>
      </div>
    </details>
  )
}

/**
 * A feature as a button.
 *
 * A `Link` styled as a button, not a `<button>`: this navigates, so it has to
 * keep middle-click, cmd-click and "copy link address". Status rides on the
 * dot's fill and recent movement on the button's own colour — two variables,
 * two channels, never the same one twice — and a moved-recently button also
 * carries its date in text, so the hue is a cue and never the message.
 */
function FeatureButton({
  feature,
  recent,
  vocabularies,
}: {
  feature: TrackerRecord
  recent: RankedActivity | undefined
  vocabularies: Vocabularies
}) {
  const status = String(feature.fields.status ?? '')
  const name = String(feature.fields.name ?? 'Untitled')
  const statusLabel = status === '' ? 'No status' : labelFor(vocabularies, 'featureStatus', status)
  // `done` and `in-progress` are the two ids the rollups already key on
  // (`releases.ts`); anything else the vocabulary grows is simply "other",
  // which is why a new status never needs a code change here.
  const state = status === 'done' ? 'done' : status === 'in-progress' ? 'doing' : 'todo'
  const moment = recent && `${recent.latest.kind === 'raised' ? 'raised' : 'due'} ${recent.latest.date}`

  return (
    <Link
      className={recent ? 'feat feat--live' : 'feat'}
      data-state={state}
      to={`/features/${encodeURIComponent(feature.id)}`}
      title={
        recent
          ? `${statusLabel} · ${moment}${recent.count > 1 ? ` · ${recent.count} moments` : ''}`
          : statusLabel
      }
    >
      <span className="feat__dot" aria-hidden="true" />
      <span className="feat__name">{name}</span>
      {recent && <span className="feat__when">{shortDate(recent.latest.date)}</span>}
      <span className="sr-only">
        {' — '}
        {statusLabel}
        {moment && `, ${moment}`}
      </span>
    </Link>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `2026-08-06` → `6 Aug`. Split, never `new Date(iso)`: parsing an ISO date as
 * UTC and rendering it in local time is exactly the off-by-one-day bug the
 * date handling elsewhere in this app is careful to avoid.
 */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return month ? `${Number(d)} ${month}` : iso
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
  to,
}: {
  title: string
  records: TrackerRecord[]
  field: string
  kind: ListKind
  vocabularies: Vocabularies
  note?: string
  /** Page the bars link into, filtered by this field. */
  to: string
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
              {/* A number on a dashboard should be a way in, not a dead end. */}
              <dt className="bar__label">
                <Link to={`${to}?${field}=${encodeURIComponent(row.id || NOT_SET)}`}>
                  {row.label}
                </Link>
              </dt>
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
