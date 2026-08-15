import { describe, expect, it } from 'vitest'
import { groupByRelease, sortGroups } from './releases'
import type { TrackerRecord } from '../sheets/rows'

let seq = 0
function record(fields: Record<string, string>): TrackerRecord {
  seq += 1
  return {
    id: `r-${seq}`,
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: 'a@example.com',
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: 'a@example.com',
    deleted: false,
    fields,
  }
}

const OURS = new Set(['architecture'])
const TODAY = new Date('2026-08-15T12:00:00Z')

describe('groupByRelease', () => {
  it('groups features by their channel and release pair', () => {
    const groups = groupByRelease(
      [
        record({ channel: 'alpha', release: 'alpha-r3' }),
        record({ channel: 'alpha', release: 'alpha-r3' }),
        record({ channel: 'alpha', release: 'alpha-r6' }),
      ],
      [],
      OURS,
      TODAY,
    )
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.release === 'alpha-r3')!.total).toBe(2)
  })

  it('keeps same-labelled releases in different channels apart', () => {
    // Release ids are channel-scoped. Merging on the release alone would report
    // one number for two different pieces of work.
    const groups = groupByRelease(
      [
        record({ channel: 'alpha', release: 'alpha-r6' }),
        record({ channel: 'beta', release: 'beta-r6' }),
      ],
      [],
      OURS,
      TODAY,
    )
    expect(groups).toHaveLength(2)
  })

  it('buckets features with no release rather than dropping them', () => {
    // 25 real features have no release; losing them would understate the work.
    const groups = groupByRelease([record({ channel: 'alpha', release: '' })], [], OURS, TODAY)
    expect(groups[0]!.release).toBe('')
    expect(groups[0]!.total).toBe(1)
  })

  it('computes percent complete from done features', () => {
    const groups = groupByRelease(
      [
        record({ channel: 'a', release: 'r1', status: 'done' }),
        record({ channel: 'a', release: 'r1', status: 'done' }),
        record({ channel: 'a', release: 'r1', status: 'not-started' }),
        record({ channel: 'a', release: 'r1', status: 'in-progress' }),
      ],
      [],
      OURS,
      TODAY,
    )
    expect(groups[0]!.done).toBe(2)
    expect(groups[0]!.percent).toBe(50)
  })

  it('sums open actions across the release’s features', () => {
    const f1 = record({ channel: 'a', release: 'r1' })
    const f2 = record({ channel: 'a', release: 'r1' })
    const groups = groupByRelease(
      [f1, f2],
      [
        record({ featureId: f1.id, status: 'open', actor: 'architecture' }),
        record({ featureId: f2.id, status: 'open', actor: 'architecture' }),
        record({ featureId: f1.id, status: 'done', actor: 'architecture' }),
      ],
      OURS,
      TODAY,
    )
    expect(groups[0]!.openActions).toBe(2)
  })

  it('excludes actions someone else performs', () => {
    const f = record({ channel: 'a', release: 'r1' })
    const groups = groupByRelease(
      [f],
      [
        record({ featureId: f.id, status: 'open', actor: 'architecture' }),
        record({ featureId: f.id, status: 'open', actor: 'delivery' }),
      ],
      OURS,
      TODAY,
    )
    expect(groups[0]!.openActions).toBe(1)
  })

  it('counts overdue separately from open', () => {
    const f = record({ channel: 'a', release: 'r1' })
    const groups = groupByRelease(
      [f],
      [
        record({ featureId: f.id, status: 'open', dueDate: '2026-08-01' }),
        record({ featureId: f.id, status: 'open', dueDate: '2026-12-01' }),
      ],
      OURS,
      TODAY,
    )
    expect(groups[0]!.openActions).toBe(2)
    expect(groups[0]!.overdue).toBe(1)
  })

  it('ignores an action whose feature is not in this set', () => {
    const groups = groupByRelease(
      [record({ channel: 'a', release: 'r1' })],
      [record({ featureId: 'orphan', status: 'open' })],
      OURS,
      TODAY,
    )
    expect(groups[0]!.openActions).toBe(0)
  })

  it('returns nothing for no features', () => {
    expect(groupByRelease([], [], OURS, TODAY)).toEqual([])
  })
})

describe('sortGroups', () => {
  const g = (channel: string, release: string) =>
    ({ channel, release, features: [], total: 0, done: 0, percent: 0, openActions: 0, overdue: 0 })

  it('orders by the vocabulary, not alphabetically', () => {
    const sorted = sortGroups(
      [g('beta', 'r2'), g('alpha', 'r2')],
      ['alpha', 'beta'],
      ['r1', 'r2'],
    )
    expect(sorted.map((s) => s.channel)).toEqual(['alpha', 'beta'])
  })

  it('orders releases within a channel by the release vocabulary', () => {
    const sorted = sortGroups([g('a', 'r3'), g('a', 'r1')], ['a'], ['r1', 'r2', 'r3'])
    expect(sorted.map((s) => s.release)).toEqual(['r1', 'r3'])
  })

  it('puts unknown values after known ones, and "not set" last of all', () => {
    // "Not set" is a gap, not a stage — it belongs at the end.
    const sorted = sortGroups(
      [g('a', ''), g('a', 'mystery'), g('a', 'r1')],
      ['a'],
      ['r1'],
    )
    expect(sorted.map((s) => s.release)).toEqual(['r1', 'mystery', ''])
  })

  it('does not mutate its input', () => {
    const input = [g('b', 'r1'), g('a', 'r1')]
    sortGroups(input, ['a', 'b'], ['r1'])
    expect(input[0]!.channel).toBe('b')
  })
})
