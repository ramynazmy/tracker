import { describe, expect, it } from 'vitest'
import { rangeFor, snapshotFromValues } from './collection'
import { entities, expectedHeaders } from '../config/schema'
import { HeaderContractError } from './rows'

const FEATURE = entities.feature
const ACTION = entities.action
const headers = [...expectedHeaders(FEATURE)]

function row(id: string, overrides: Record<string, unknown> = {}): unknown[] {
  const values: Record<string, unknown> = {
    id,
    createdAt: '2026-08-01T00:00:00Z',
    createdBy: 'a@example.com',
    updatedAt: '2026-08-01T00:00:00Z',
    updatedBy: 'a@example.com',
    deleted: false,
    name: `Feature ${id}`,
    ...overrides,
  }
  return headers.map((h) => values[h] ?? '')
}

describe('rangeFor', () => {
  it('uses A:ZZ, not A:Z', () => {
    // A:Z silently truncates past 26 columns; the symptom is "my new field
    // isn't loading" rather than an error.
    expect(rangeFor(FEATURE)).toBe('Features!A:ZZ')
    expect(rangeFor(ACTION)).toBe('Actions!A:ZZ')
  })
})

describe('snapshotFromValues', () => {
  it('indexes records by id and keeps their row numbers', () => {
    const snapshot = snapshotFromValues(FEATURE, [headers, row('a'), row('b')])
    expect(snapshot.records.size).toBe(2)
    // +1 for the header, +1 because sheet rows are 1-based.
    expect(snapshot.rowNumbers.get('a')).toBe(2)
    expect(snapshot.rowNumbers.get('b')).toBe(3)
  })

  it('drops rows with no id — a stray note typed below the data', () => {
    const snapshot = snapshotFromValues(FEATURE, [headers, row('a'), row(''), row('b')])
    expect(snapshot.live.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('keeps row numbers correct despite a skipped row', () => {
    // The id-less row still occupies a line in the sheet, so everything below
    // it must not shift up by one.
    const snapshot = snapshotFromValues(FEATURE, [headers, row(''), row('b')])
    expect(snapshot.rowNumbers.get('b')).toBe(3)
  })

  it('excludes deleted records from live but keeps them resolvable', () => {
    const snapshot = snapshotFromValues(FEATURE, [headers, row('a'), row('gone', { deleted: true })])
    expect(snapshot.live.map((r) => r.id)).toEqual(['a'])
    expect(snapshot.records.has('gone')).toBe(true)
    // Still addressable, so an update against a soft-deleted row can be
    // resolved rather than reported as gone.
    expect(snapshot.rowNumbers.get('gone')).toBe(3)
  })

  it('sorts live records by updatedAt, newest first', () => {
    const snapshot = snapshotFromValues(FEATURE, [
      headers,
      row('old', { updatedAt: '2026-08-01T00:00:00Z' }),
      row('new', { updatedAt: '2026-08-14T00:00:00Z' }),
      row('mid', { updatedAt: '2026-08-07T00:00:00Z' }),
    ])
    expect(snapshot.live.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('returns empty maps for a tab with only a header row', () => {
    const snapshot = snapshotFromValues(FEATURE, [headers])
    expect(snapshot.live).toEqual([])
    expect(snapshot.records.size).toBe(0)
  })

  it('returns empty rather than throwing on a completely empty tab', () => {
    expect(snapshotFromValues(FEATURE, []).live).toEqual([])
  })

  it('rejects a tab whose headers belong to another entity', () => {
    expect(() => snapshotFromValues(ACTION, [headers, row('a')])).toThrow(HeaderContractError)
  })
})
