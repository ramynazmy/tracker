import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { entities, type Field } from '../config/schema'
import EntityFilters, { useEntityFilters } from '../components/EntityFilters'
import LoadError from '../components/LoadError'
import { useTracker } from '../data/TrackerDataContext'
import { applyFilters } from '../lib/filters'
import { isOwnedAction } from '../lib/rollups'
import { buildTimeline, groupByMonth, monthLabel } from '../lib/timeline'
import { labelFor } from '../sheets/lists'
import type { TrackerRecord } from '../sheets/rows'

const FEATURE = entities.feature
const ACTION = entities.action

const field = (entity: typeof FEATURE, key: string): Field =>
  entity.fields.find((f) => f.key === key)!

/**
 * Filters span both entities: channel and release describe the *feature*, type
 * and actor describe the *action*. Keys are chosen not to collide — both
 * entities have `owner` and `status`, and one URL param cannot mean both.
 */
const FEATURE_FILTERS = [field(FEATURE, 'channel'), field(FEATURE, 'release')]
const ACTION_FILTERS = [field(ACTION, 'type'), field(ACTION, 'actor')]
const ALL_FILTERS = [...FEATURE_FILTERS, ...ACTION_FILTERS]

/** UTC, matching every other date in the app. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function Timeline() {
  const { features, actions, vocabularies, featureNames, ownedActors, loading, error, loadedAt } =
    useTracker()
  const filters = useEntityFilters(ALL_FILTERS)

  // A single feature's chronology, linked from its detail page. A search
  // param rather than a route so the rest of the page — filters, grouping,
  // rendering — is exactly the shared timeline, not a second one.
  const [params, setParams] = useSearchParams()
  const featureId = params.get('feature') ?? ''
  const featureName = featureId ? featureNames.get(featureId) : undefined

  const today = todayIso()

  const months = useMemo(() => {
    const featureValues = new Map(features.map((f) => [f.id, f.fields]))
    const all = featureId
      ? actions.filter((a) => String(a.fields.featureId ?? '') === featureId)
      : actions

    // A feature-level filter has to reach through the action's link, so this
    // is a join rather than a field match — which is why applyFilters, which
    // only knows about a record's own fields, is used twice with two slices.
    const featureFiltered = applyFilters(features, {
      channel: filters.values.channel ?? '',
      release: filters.values.release ?? '',
    })
    const allowed = new Set(featureFiltered.map((f) => f.id))

    const scoped = all.filter((a) => {
      const featureId = String(a.fields.featureId ?? '')
      // An action with no resolvable feature can't answer a feature-level
      // question; only show it when no such filter is applied.
      if (!featureValues.has(featureId)) {
        return !filters.values.channel && !filters.values.release
      }
      return allowed.has(featureId)
    })

    const byAction = applyFilters(scoped, {
      type: filters.values.type ?? '',
      actor: filters.values.actor ?? '',
    })

    return groupByMonth(buildTimeline(byAction, today))
  }, [features, actions, featureId, filters.values, today])

  const total = months.reduce((n, m) => n + m.entries.length, 0)

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  return (
    <section className={loading && total > 0 ? 'is-refetching' : undefined}>
      <div className="page-head">
        <div>
          <h1>Timeline</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'} · {total} dated{' '}
            {total === 1 ? 'moment' : 'moments'}
          </p>
        </div>
      </div>

      {featureId && (
        <div className="card">
          <strong>
            Timeline of{' '}
            {featureName ? (
              <Link to={`/features/${encodeURIComponent(featureId)}`}>{featureName}</Link>
            ) : (
              'a feature no longer in the sheet'
            )}
          </strong>{' '}
          <button
            className="btn btn--link"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('feature')
              setParams(next, { replace: true })
            }}
          >
            Show the full timeline
          </button>
        </div>
      )}

      <EntityFilters
        fields={ALL_FILTERS}
        vocabularies={vocabularies}
        values={filters.values}
        onChange={filters.setValue}
        onClear={filters.clear}
      />

      {total === 0 ? (
        <p className="muted">
          Nothing dated to show. Actions need a Start or Due date to appear here.
        </p>
      ) : (
        months.map((month) => (
          <div key={month.month} className="tl-month">
            <h2 className="tl-month__label">{monthLabel(month.month)}</h2>
            <ol className="tl">
              {month.entries.map((entry) => {
                // "Overdue" is a statement about work WE owe. An event —
                // somebody else's milestone, saved with no status — would
                // otherwise read as overdue the day after it happens, because
                // a blank status counts as open.
                const ours = isOwnedAction(entry.action, ownedActors)
                const overdue = entry.overdue && ours
                return (
                <li
                  key={entry.key}
                  className={`tl__item${entry.past ? '' : ' tl__item--future'}`}
                >
                  <time className="tl__date" dateTime={entry.date}>
                    {entry.date}
                  </time>
                  {/* Shape carries past-vs-future, not colour alone. */}
                  <span
                    className={`tl__dot${entry.past ? '' : ' tl__dot--hollow'}${
                      overdue ? ' tl__dot--overdue' : ''
                    }`}
                    aria-hidden
                  />
                  <div className="tl__body">
                    <p className="tl__title">
                      <span className="tl__kind">
                        {!ours ? 'Event' : entry.kind === 'raised' ? 'Started' : 'Due'}
                      </span>{' '}
                      {String(entry.action.fields[ACTION.titleField] ?? '(untitled)')}
                      {/* Never colour alone: overdue says so in words. */}
                      {overdue && <span className="tl__flag">overdue</span>}
                    </p>
                    <p className="tl__meta muted">
                      <FeatureLink action={entry.action} featureNames={featureNames} />
                      {entry.action.fields.type && (
                        <> · {labelFor(vocabularies, 'actionType', String(entry.action.fields.type))}</>
                      )}
                      {' · '}
                      {entry.action.fields.actor
                        ? labelFor(vocabularies, 'actor', String(entry.action.fields.actor))
                        : 'Architecture'}
                    </p>
                  </div>
                </li>
                )
              })}
            </ol>
          </div>
        ))
      )}
    </section>
  )
}

function FeatureLink({
  action,
  featureNames,
}: {
  action: TrackerRecord
  featureNames: ReadonlyMap<string, string>
}) {
  const id = String(action.fields.featureId ?? '')
  const name = featureNames.get(id)
  if (!name) return <span className="chip chip--unknown">Unknown feature</span>
  return <Link to={`/features/${encodeURIComponent(id)}`}>{name}</Link>
}
