import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import LoadError from '../components/LoadError'
import { useTracker } from '../data/TrackerDataContext'
import { groupByRelease, sortGroups, type ReleaseGroup } from '../lib/releases'
import { NOT_SET } from '../lib/filters'
import { labelFor, vocabularyOf } from '../sheets/lists'

export default function Releases() {
  const { features, actions, vocabularies, ownedActors, loading, error, loadedAt } = useTracker()

  const groups = useMemo(() => {
    const raw = groupByRelease(features, actions, ownedActors, new Date())
    return sortGroups(
      raw,
      vocabularyOf(vocabularies, 'channel').active.map((i) => i.id),
      vocabularyOf(vocabularies, 'release').active.map((i) => i.id),
    )
  }, [features, actions, ownedActors, vocabularies])

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  return (
    <section className={loading && groups.length > 0 ? 'is-refetching' : undefined}>
      <div className="page-head">
        <div>
          <h1>Releases</h1>
          <p className="muted">
            {loadedAt ? `As of ${loadedAt.toLocaleTimeString()}` : 'Loading…'} · {groups.length}{' '}
            {groups.length === 1 ? 'release' : 'releases'}
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="muted">No features yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="records releases">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Release</th>
                <th className="cell--number">Features</th>
                <th className="cell--number">Done</th>
                <th>Progress</th>
                <th className="cell--number">Open on us</th>
                <th className="cell--number">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Row key={`${group.channel} ${group.release}`} group={group} label={label} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )

  function label(kind: 'channel' | 'release', id: string): string {
    return id === '' ? 'Not set' : labelFor(vocabularies, kind, id)
  }
}

function Row({
  group,
  label,
}: {
  group: ReleaseGroup
  label: (kind: 'channel' | 'release', id: string) => string
}) {
  // Every row links to the features behind it — a count that cannot be opened
  // makes you go and rebuild the filter by hand.
  const href =
    `/features?channel=${encodeURIComponent(group.channel || NOT_SET)}` +
    `&release=${encodeURIComponent(group.release || NOT_SET)}`

  return (
    <tr>
      <td>{label('channel', group.channel)}</td>
      <td>
        <Link to={href}>{label('release', group.release)}</Link>
      </td>
      <td className="cell--number">{group.total}</td>
      <td className="cell--number">{group.done}</td>
      <td className="releases__progress">
        {/* A single ratio against a limit is a meter, not a chart. The value is
            beside it in text, so the bar is never the only way to read it. */}
        <div className="meter meter--inline">
          <div className="meter__fill" style={{ width: `${group.percent}%` }} />
        </div>
        <span className="releases__percent">{group.percent}%</span>
      </td>
      <td className="cell--number">{group.openActions || <span className="muted">—</span>}</td>
      <td className="cell--number">
        {group.overdue > 0 ? (
          <span className="tl__flag">{group.overdue}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  )
}
