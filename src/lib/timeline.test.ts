import { describe, expect, it } from 'vitest'
import { buildTimeline, groupByMonth, monthLabel } from './timeline'
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
    fields: { status: 'open', ...fields },
  }
}

const TODAY = '2026-08-15'

describe('buildTimeline', () => {
  it('yields one entry per date an action carries', () => {
    const entries = buildTimeline(
      [action({ raisedOn: '2026-08-01', dueDate: '2026-08-20' })],
      TODAY,
    )
    expect(entries.map((e) => e.kind)).toEqual(['raised', 'due'])
  })

  it('yields nothing for an action with no dates', () => {
    expect(buildTimeline([action({ name: 'undated' })], TODAY)).toEqual([])
  })

  it('sorts oldest first', () => {
    const entries = buildTimeline(
      [action({ raisedOn: '2026-09-01' }), action({ raisedOn: '2026-07-01' })],
      TODAY,
    )
    expect(entries.map((e) => e.date)).toEqual(['2026-07-01', '2026-09-01'])
  })

  it('puts raised before due on the same day', () => {
    // Something is raised before it can fall due.
    const entries = buildTimeline(
      [action({ raisedOn: '2026-08-10', dueDate: '2026-08-10' })],
      TODAY,
    )
    expect(entries.map((e) => e.kind)).toEqual(['raised', 'due'])
  })

  it('treats today as past, so today’s entries render as reached', () => {
    const [entry] = buildTimeline([action({ raisedOn: TODAY })], TODAY)
    expect(entry!.past).toBe(true)
  })

  it('marks tomorrow as future', () => {
    const [entry] = buildTimeline([action({ raisedOn: '2026-08-16' })], TODAY)
    expect(entry!.past).toBe(false)
  })

  it('flags an open action past its due date', () => {
    const [entry] = buildTimeline([action({ dueDate: '2026-08-01', status: 'open' })], TODAY)
    expect(entry!.overdue).toBe(true)
  })

  it('does not flag a closed action past its due date', () => {
    // A missed date on finished work is history, not a problem.
    const [entry] = buildTimeline([action({ dueDate: '2026-08-01', status: 'done' })], TODAY)
    expect(entry!.overdue).toBe(false)
  })

  it('does not flag something due today as already overdue', () => {
    const [entry] = buildTimeline([action({ dueDate: TODAY, status: 'open' })], TODAY)
    expect(entry!.overdue).toBe(false)
  })

  it('never flags a raised entry as overdue', () => {
    const [entry] = buildTimeline([action({ raisedOn: '2020-01-01', status: 'open' })], TODAY)
    expect(entry!.kind).toBe('raised')
    expect(entry!.overdue).toBe(false)
  })

  it('skips a malformed date rather than guessing its position', () => {
    // The source workbook contains a due date typed "1508/2026".
    expect(buildTimeline([action({ dueDate: '1508/2026' })], TODAY)).toEqual([])
  })

  it('gives every entry a distinct key', () => {
    const entries = buildTimeline(
      [
        action({ raisedOn: '2026-08-01', dueDate: '2026-08-02' }),
        action({ raisedOn: '2026-08-01', dueDate: '2026-08-02' }),
      ],
      TODAY,
    )
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
  })
})

describe('groupByMonth', () => {
  it('groups entries into their months in order', () => {
    const months = groupByMonth(
      buildTimeline(
        [
          action({ raisedOn: '2026-07-30' }),
          action({ raisedOn: '2026-08-02' }),
          action({ raisedOn: '2026-08-20' }),
        ],
        TODAY,
      ),
    )
    expect(months.map((m) => m.month)).toEqual(['2026-07', '2026-08'])
    expect(months[1]!.entries).toHaveLength(2)
  })

  it('returns nothing for no entries', () => {
    expect(groupByMonth([])).toEqual([])
  })
})

describe('monthLabel', () => {
  it('reads as a month and year', () => {
    expect(monthLabel('2026-08')).toMatch(/2026/)
  })

  it('is timezone-independent at a month boundary', () => {
    // A local-time conversion would render 2026-01 as December 2025 west of UTC.
    expect(monthLabel('2026-01')).toMatch(/2026/)
  })
})
