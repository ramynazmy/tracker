import { describe, expect, it } from 'vitest'
import { activeFilterCount, applyFilters, filterableFields, NOT_SET } from './filters'
import { entities } from '../config/schema'
import type { TrackerRecord } from '../sheets/rows'

let seq = 0
function feature(fields: Record<string, string>): TrackerRecord {
  seq += 1
  return {
    id: `feature-${seq}`,
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: 'a@example.com',
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: 'a@example.com',
    deleted: false,
    fields,
  }
}

describe('filterableFields', () => {
  it('offers every reference field of an entity', () => {
    const keys = filterableFields(entities.feature).map((f) => f.key)
    expect(keys).toContain('channel')
    expect(keys).toContain('release')
    expect(keys).toContain('status')
  })

  it('leaves free-text and dates out — they have no bounded value set', () => {
    const keys = filterableFields(entities.feature).map((f) => f.key)
    expect(keys).not.toContain('name')
    expect(keys).not.toContain('notes')
    expect(filterableFields(entities.action).map((f) => f.key)).not.toContain('dueDate')
  })

  it('leaves the feature link out — it is not a bounded vocabulary', () => {
    expect(filterableFields(entities.action).map((f) => f.key)).not.toContain('featureId')
  })
})

describe('applyFilters', () => {
  const records = [
    feature({ channel: 'alpha', release: 'alpha-r3', status: 'done' }),
    feature({ channel: 'alpha', release: 'alpha-r6', status: 'not-started' }),
    feature({ channel: 'beta', release: 'beta-r6', status: 'done' }),
    feature({ channel: 'beta', release: '', status: 'done' }),
  ]

  it('returns everything when nothing is selected', () => {
    expect(applyFilters(records, {})).toHaveLength(4)
    expect(applyFilters(records, { channel: '', status: '' })).toHaveLength(4)
  })

  it('narrows on one field', () => {
    expect(applyFilters(records, { channel: 'alpha' })).toHaveLength(2)
  })

  it('ANDs multiple fields rather than ORing them', () => {
    // Two filters must narrow, not widen — the common way this goes wrong.
    expect(applyFilters(records, { channel: 'alpha', status: 'done' })).toHaveLength(1)
  })

  it('can select records where the value is not set', () => {
    // "No release yet" is a real question people ask; 25 features have none.
    const found = applyFilters(records, { release: NOT_SET })
    expect(found).toHaveLength(1)
    expect(found[0]!.fields.channel).toBe('beta')
  })

  it('does not treat a missing key as a match for NOT_SET on another field', () => {
    expect(applyFilters(records, { channel: 'alpha', release: NOT_SET })).toHaveLength(0)
  })

  it('returns nothing when the combination has no members', () => {
    expect(applyFilters(records, { channel: 'alpha', status: 'in-progress' })).toEqual([])
  })

  it('does not mutate the input', () => {
    const before = [...records]
    applyFilters(records, { channel: 'alpha' })
    expect(records).toEqual(before)
  })

  it('trims stored whitespace before comparing', () => {
    const padded = [feature({ channel: '  alpha  ' })]
    expect(applyFilters(padded, { channel: 'alpha' })).toHaveLength(1)
  })
})

describe('activeFilterCount', () => {
  it('counts only the fields actually narrowing', () => {
    expect(activeFilterCount({ channel: 'alpha', release: '', status: 'done' })).toBe(2)
    expect(activeFilterCount({})).toBe(0)
  })

  it('counts a NOT_SET selection as active', () => {
    expect(activeFilterCount({ release: NOT_SET })).toBe(1)
  })
})
