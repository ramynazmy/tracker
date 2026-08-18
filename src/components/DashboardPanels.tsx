/**
 * The building blocks the Dashboard and Management pages share: the channel
 * card (with its release disclosures and feature buttons), the KPI stat tile,
 * and the horizontal-bar breakdown.
 *
 * Extracted from Dashboard.tsx when the Management page arrived — the two
 * pages show the same shapes over different slices of the features, and a
 * copied card would drift the moment one page's rendering was fixed alone.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { type ListKind } from '../config/schema'
import { ACTIVE_WINDOW_DAYS, recentActivity, type FeatureActivity } from '../lib/activity'
import { NOT_SET } from '../lib/filters'
import { groupByRelease, sortGroups, type ReleaseGroup } from '../lib/releases'
import { countBy } from '../lib/rollups'
import { labelFor, vocabularyOf, type Vocabularies } from '../sheets/lists'
import type { TrackerRecord } from '../sheets/rows'

export interface ChannelView {
  id: string
  releases: ReleaseGroup[]
  active: FeatureActivity[]
  /** The channel's most recent dated moment inside the window, if any. */
  latest?: string
}

/**
 * Group a slice of features into channels, each with its release rollups and
 * its recent activity. The caller decides WHICH features are in the slice —
 * the dashboard passes the active ones, the management page the tracked ones —
 * and a channel with nothing in the slice simply does not appear.
 */
export function buildChannelView(
  features: readonly TrackerRecord[],
  actions: readonly TrackerRecord[],
  ownedActors: ReadonlySet<string>,
  vocabularies: Vocabularies,
  today: string,
): ChannelView[] {
  const groups = sortGroups(
    groupByRelease(features, actions, ownedActors, new Date()),
    vocabularyOf(vocabularies, 'channel').active.map((i) => i.id),
    vocabularyOf(vocabularies, 'release').active.map((i) => i.id),
  )

  const activity = recentActivity(actions, today)
  const featureChannel = new Map(features.map((f) => [f.id, String(f.fields.channel ?? '')]))

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

  const channels: ChannelView[] = [...byChannel.entries()].map(([id, value]) => ({
    id,
    ...value,
    // `recentActivity` returns most-recent first, so the head of the list IS
    // the channel's latest moment.
    latest: value.active[0]?.latest.date,
  }))

  // Busiest first: the channel that moved most recently leads the page, so the
  // card order itself says where the attention is. Quiet channels keep their
  // vocabulary order after the active ones — stable sort, undated last.
  return channels.sort((a, b) => (b.latest ?? '').localeCompare(a.latest ?? ''))
}

/**
 * The banner both dashboards lead with: percent complete, its basis in words,
 * the meter, and the moved-recently pill. One component so the two pages can
 * never drift apart visually — they differ only in the slice behind the
 * numbers, which the `noun` spells out ("features" vs "tracked features").
 */
export function Hero({
  done,
  total,
  noun,
  moved,
}: {
  done: number
  total: number
  /** What the numbers count, e.g. "features" or "tracked features". */
  noun: string
  /** Features with a dated moment in the window; 0 hides the pill. */
  moved: number
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="hero">
      <p className="hero__value">{percent}%</p>
      <p className="hero__label">
        complete — {done} of {total} {noun} done
      </p>
      <div className="meter" role="img" aria-label={`${percent} percent complete`}>
        <div className="meter__fill" style={{ width: `${percent}%` }} />
      </div>
      {moved > 0 && (
        <p className="hero__live">
          {moved} {moved === 1 ? 'feature has' : 'features have'} moved in the last{' '}
          {ACTIVE_WINDOW_DAYS} days
        </p>
      )}
    </div>
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

export function ChannelCard({
  channelId,
  releases,
  active,
  latest,
  vocabularies,
}: {
  channelId: string
  releases: ReleaseGroup[]
  active: FeatureActivity[]
  /** Most recent dated moment in the channel — an action starting, an event. */
  latest?: string
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
          {/* The card wears its own recency, which is also its sort key — the
              page orders channels by this date, so saying it keeps the order
              legible rather than mysterious. */}
          {latest && <> · moved {shortDate(latest)}</>}
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

export function Stat({
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
export function Breakdown({
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
