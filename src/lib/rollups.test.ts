import { describe, expect, it } from 'vitest'
import {
  actionsForFeature,
  countBy,
  countOpenActionsByFeature,
  daysOverdue,
  isOpenAction,
  isOwnedAction,
  orphanActions,
} from './rollups'
import type { TrackerRecord } from '../sheets/rows'

let seq = 0
function action(fields: Record<string, string>): TrackerRecord {
  seq += 1
  return {
    id: `action-${seq}`,
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: 'a@example.com',
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: 'a@example.com',
    deleted: false,
    fields,
  }
}

describe('isOpenAction', () => {
  it('counts Open and In Progress as open', () => {
    expect(isOpenAction(action({ status: 'open' }))).toBe(true)
    expect(isOpenAction(action({ status: 'in-progress' }))).toBe(true)
  })

  it('counts Done and Cancelled as closed', () => {
    expect(isOpenAction(action({ status: 'done' }))).toBe(false)
    expect(isOpenAction(action({ status: 'cancelled' }))).toBe(false)
  })

  it('ignores case and surrounding space', () => {
    expect(isOpenAction(action({ status: '  DONE ' }))).toBe(false)
  })

  it('counts a blank status as open', () => {
    // Better to over-report than to let an unfilled row vanish from the view
    // of what still needs doing.
    expect(isOpenAction(action({ status: '' }))).toBe(true)
    expect(isOpenAction(action({}))).toBe(true)
  })

  it('counts a NEW status as open — the divergence from the workbook', () => {
    // The workbook tested positively for Open OR In Progress. Action statuses
    // are editable data now, so the moment someone adds "Blocked" that test
    // would silently stop counting those actions. This negative test is what
    // makes adding a status safe.
    expect(isOpenAction(action({ status: 'blocked' }))).toBe(true)
    expect(isOpenAction(action({ status: 'awaiting-carb' }))).toBe(true)
  })
})

describe('isOwnedAction', () => {
  it('counts the architecture team as ours', () => {
    expect(isOwnedAction(action({ actor: 'architecture' }))).toBe(true)
  })

  it('counts anyone else as not ours', () => {
    expect(isOwnedAction(action({ actor: 'delivery' }))).toBe(false)
    expect(isOwnedAction(action({ actor: 'vendor' }))).toBe(false)
  })

  it('counts a blank actor as ours', () => {
    // Every action predates this field. Treating blank as somebody else's
    // would silently zero every rollup on the board at once.
    expect(isOwnedAction(action({ actor: '' }))).toBe(true)
    expect(isOwnedAction(action({}))).toBe(true)
  })
})

describe('countOpenActionsByFeature', () => {
  it('excludes open work someone else does', () => {
    // The whole risk of holding the timeline in one tab: a delivery milestone
    // must not inflate what this team is shown as owing.
    const counts = countOpenActionsByFeature([
      action({ featureId: 'f1', status: 'open', actor: 'architecture' }),
      action({ featureId: 'f1', status: 'open', actor: 'delivery' }),
      action({ featureId: 'f1', status: 'open', actor: 'vendor' }),
    ])
    expect(counts.get('f1')).toBe(1)
  })

  it('still counts pre-existing actions that have no actor', () => {
    const counts = countOpenActionsByFeature([action({ featureId: 'f1', status: 'open' })])
    expect(counts.get('f1')).toBe(1)
  })

  it('counts only open actions, grouped by feature', () => {
    const counts = countOpenActionsByFeature([
      action({ featureId: 'f1', status: 'open' }),
      action({ featureId: 'f1', status: 'in-progress' }),
      action({ featureId: 'f1', status: 'done' }),
      action({ featureId: 'f2', status: 'open' }),
    ])
    expect(counts.get('f1')).toBe(2)
    expect(counts.get('f2')).toBe(1)
  })

  it('omits a feature whose actions are all closed', () => {
    const counts = countOpenActionsByFeature([action({ featureId: 'f1', status: 'done' })])
    // Absent, not zero — the caller renders `?? 0`, so both read the same.
    expect(counts.get('f1')).toBeUndefined()
  })

  it('ignores an action with no feature', () => {
    const counts = countOpenActionsByFeature([action({ featureId: '', status: 'open' })])
    expect(counts.size).toBe(0)
  })
})

describe('actionsForFeature', () => {
  it('returns only that feature’s actions', () => {
    const all = [
      action({ featureId: 'f1', name: 'a' }),
      action({ featureId: 'f2', name: 'b' }),
      action({ featureId: 'f1', name: 'c' }),
    ]
    expect(actionsForFeature(all, 'f1').map((a) => a.fields.name)).toEqual(['a', 'c'])
  })

  it('returns nothing for a feature with none, rather than everything', () => {
    expect(actionsForFeature([action({ featureId: 'f1' })], 'f9')).toEqual([])
  })
})

describe('orphanActions', () => {
  const live = new Set(['f1', 'f2'])

  it('finds actions pointing at a feature that is gone', () => {
    const orphans = orphanActions([action({ featureId: 'deleted-feature' })], live)
    expect(orphans).toHaveLength(1)
  })

  it('finds actions with no link at all', () => {
    expect(orphanActions([action({ featureId: '' }), action({})], live)).toHaveLength(2)
  })

  it('leaves well-linked actions alone', () => {
    expect(orphanActions([action({ featureId: 'f1' })], live)).toEqual([])
  })
})

describe('daysOverdue', () => {
  const today = new Date('2026-08-15T12:00:00Z')

  it('counts whole days past the due date', () => {
    expect(daysOverdue(action({ status: 'open', dueDate: '2026-08-10' }), today)).toBe(5)
  })

  it('returns null on the due date itself', () => {
    expect(daysOverdue(action({ status: 'open', dueDate: '2026-08-15' }), today)).toBeNull()
  })

  it('returns null for a future date', () => {
    expect(daysOverdue(action({ status: 'open', dueDate: '2026-09-01' }), today)).toBeNull()
  })

  it('never reports a closed action as overdue', () => {
    expect(daysOverdue(action({ status: 'done', dueDate: '2026-01-01' }), today)).toBeNull()
  })

  it('ignores a missing or malformed date rather than guessing', () => {
    // The source workbook contains exactly this: a due date typed "1508/2026".
    expect(daysOverdue(action({ status: 'open', dueDate: '1508/2026' }), today)).toBeNull()
    expect(daysOverdue(action({ status: 'open' }), today)).toBeNull()
  })

  it('is timezone-independent', () => {
    // Would differ by a day if the comparison used local time.
    const lateInDay = new Date('2026-08-15T23:59:59Z')
    const earlyInDay = new Date('2026-08-15T00:00:01Z')
    const overdue = action({ status: 'open', dueDate: '2026-08-14' })
    expect(daysOverdue(overdue, lateInDay)).toBe(daysOverdue(overdue, earlyInDay))
  })
})

describe('countBy', () => {
  it('groups records by a field value', () => {
    const counts = countBy(
      [action({ owner: 'owner-a' }), action({ owner: 'owner-a' }), action({ owner: 'owner-b' })],
      'owner',
    )
    expect(counts.get('owner-a')).toBe(2)
    expect(counts.get('owner-b')).toBe(1)
  })

  it('buckets blanks together under the empty string', () => {
    expect(countBy([action({}), action({ owner: '' })], 'owner').get('')).toBe(2)
  })
})
