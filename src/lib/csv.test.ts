import { describe, expect, it } from 'vitest'
import { recordsToCsv } from './csv'
import { entities } from '../config/schema'
import type { TrackerRecord } from '../sheets/rows'

const FEATURE = entities.feature

const base: Omit<TrackerRecord, 'fields'> = {
  id: 'uuid-1',
  createdAt: '2026-08-14T10:00:00Z',
  createdBy: 'a@example.com',
  updatedAt: '2026-08-14T11:00:00Z',
  updatedBy: 'b@example.com',
  deleted: false,
}

const record = (fields: TrackerRecord['fields']): TrackerRecord => ({ ...base, fields })

describe('recordsToCsv', () => {
  it('quotes values containing commas, quotes or newlines', () => {
    const csv = recordsToCsv(FEATURE, [record({ name: 'a,b', notes: 'say "hi"' })])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
  })

  it('quotes a value containing a newline rather than breaking the row', () => {
    const csv = recordsToCsv(FEATURE, [record({ notes: 'line one\nline two' })])
    expect(csv).toContain('"line one\nline two"')
    // Header + one record, so exactly one CRLF row separator.
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('neutralises formulas — a CSV opened in Excel evaluates them too', () => {
    const csv = recordsToCsv(FEATURE, [record({ name: '=IMPORTDATA("http://x")' })])
    expect(csv).toContain("'=IMPORTDATA")
  })

  it('renders blank fields as empty, not "null"', () => {
    const csv = recordsToCsv(FEATURE, [record({ name: null })])
    expect(csv).not.toContain('null')
  })

  it('emits a header row even with no records', () => {
    const csv = recordsToCsv(FEATURE, [])
    expect(csv.split('\r\n')).toHaveLength(1)
    expect(csv).toContain('id,createdAt')
  })
})
