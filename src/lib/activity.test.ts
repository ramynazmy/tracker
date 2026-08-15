import { describe, expect, it } from 'vitest'
import { activeFeatureIds, recentActivity, shiftDays } from './activity'
import type { TrackerRecord } from '../sheets/rows'

let seq = 0
function action(fields: Record<string, string>): TrackerRecord {
  seq += 1
  return {
    id: `a-${seq}`,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'a@example.com',
    // Deliberately "now": the migration stamped every row, and activity must
    // not be derived from it.
    updatedAt: '2026-08-15T00:00:00Z',
    updatedBy: 'a@example.com',
    deleted: false,
    fields: { status: 'open', ...fields },
  }
}

const TODAY = '2026-08-15'

describe('shiftDays', () => {
  it('moves backwards and forwards', () => {
    expect(shiftDays('2026-08-15', -14)).toBe('2026-08-01')
    expect(shiftDays('2026-08-15', 1)).toBe('2026-08-16')
  })

  it('crosses a month boundary', () => {
    expect(shiftDays('2026-08-01', -1)).toBe('2026-07-31')
  })

  it('crosses a year boundary', () => {
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles a leap day', () => {
    expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29')
  })
})

describe('recentActivity', () => {
  it('includes a feature whose action was raised inside the window', () => {
    const found = recentActivity([action({ featureId: 'f1', raisedOn: '2026-08-10' })], TODAY)
    expect(found.map((a) => a.featureId)).toEqual(['f1'])
  })

  it('includes today itself', () => {
    expect(recentActivity([action({ featureId: 'f1', raisedOn: TODAY })], TODAY)).toHaveLength(1)
  })

  it('includes the oldest day in the window', () => {
    // 14 days inclusive reaches back 13 days, so the window is 08-02..08-15.
    expect(
      recentActivity([action({ featureId: 'f1', raisedOn: '2026-08-02' })], TODAY),
    ).toHaveLength(1)
  })

  it('excludes the day before the window opens', () => {
    expect(
      recentActivity([action({ featureId: 'f1', raisedOn: '2026-08-01' })], TODAY),
    ).toEqual([])
  })

  it('excludes a future date — that is upcoming, not activity', () => {
    expect(recentActivity([action({ featureId: 'f1', dueDate: '2026-08-20' })], TODAY)).toEqual([])
  })

  it('counts a due date that has passed inside the window', () => {
    const found = recentActivity([action({ featureId: 'f1', dueDate: '2026-08-12' })], TODAY)
    expect(found[0]!.latest.kind).toBe('due')
  })

  it('ignores updatedAt entirely', () => {
    // Every migrated row carries today's updatedAt. Using it would have marked
    // every feature active on day one.
    expect(recentActivity([action({ featureId: 'f1' })], TODAY)).toEqual([])
  })

  it('collapses several moments onto one feature and counts them', () => {
    const found = recentActivity(
      [
        action({ featureId: 'f1', raisedOn: '2026-08-05' }),
        action({ featureId: 'f1', raisedOn: '2026-08-11', dueDate: '2026-08-12' }),
      ],
      TODAY,
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.count).toBe(3)
  })

  it('reports the most recent moment as the latest', () => {
    const found = recentActivity(
      [
        action({ featureId: 'f1', raisedOn: '2026-08-05' }),
        action({ featureId: 'f1', raisedOn: '2026-08-13' }),
      ],
      TODAY,
    )
    expect(found[0]!.latest.date).toBe('2026-08-13')
  })

  it('sorts most recently active first', () => {
    const found = recentActivity(
      [
        action({ featureId: 'older', raisedOn: '2026-08-04' }),
        action({ featureId: 'newer', raisedOn: '2026-08-14' }),
      ],
      TODAY,
    )
    expect(found.map((a) => a.featureId)).toEqual(['newer', 'older'])
  })

  it('counts an event the same as an action', () => {
    // An event is an action with another actor; a delivery milestone landing
    // is exactly the movement this is meant to surface.
    const found = recentActivity(
      [action({ featureId: 'f1', raisedOn: '2026-08-10', actor: 'delivery' })],
      TODAY,
    )
    expect(found).toHaveLength(1)
  })

  it('ignores an action with no feature', () => {
    expect(recentActivity([action({ featureId: '', raisedOn: TODAY })], TODAY)).toEqual([])
  })

  it('honours a custom window', () => {
    const actions = [action({ featureId: 'f1', raisedOn: '2026-08-10' })]
    expect(recentActivity(actions, TODAY, 3)).toEqual([])
    expect(recentActivity(actions, TODAY, 30)).toHaveLength(1)
  })
})

describe('activeFeatureIds', () => {
  it('returns just the ids', () => {
    const ids = activeFeatureIds(
      [action({ featureId: 'f1', raisedOn: '2026-08-10' }), action({ featureId: 'f2' })],
      TODAY,
    )
    expect([...ids]).toEqual(['f1'])
  })
})
