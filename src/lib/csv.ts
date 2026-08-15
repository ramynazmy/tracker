import { HOUSEKEEPING_COLUMNS, type EntitySchema } from '../config/schema'
import type { TrackerRecord } from '../sheets/rows'

/**
 * RFC 4180 quoting: wrap in quotes when the value contains a comma, quote or
 * newline, and double any embedded quotes.
 *
 * The leading-character guard is the same formula-injection defence used when
 * writing to the sheet — a CSV opened in Excel or Sheets will evaluate a cell
 * starting with = just as readily.
 */
function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Housekeeping minus `deleted`: an export of live records is all undeleted. */
const EXPORT_HOUSEKEEPING = HOUSEKEEPING_COLUMNS.filter((c) => c !== 'deleted')

export function recordsToCsv(entity: EntitySchema, records: TrackerRecord[]): string {
  const headers = [...EXPORT_HOUSEKEEPING, ...entity.fields.map((f) => f.key)]

  const lines = [
    headers.join(','),
    ...records.map((record) =>
      [
        record.id,
        record.createdAt,
        record.createdBy,
        record.updatedAt,
        record.updatedBy,
        ...entity.fields.map((field) => record.fields[field.key] ?? ''),
      ]
        .map(escapeCsv)
        .join(','),
    ),
  ]

  // CRLF per the spec; Excel is happier with it and everything else tolerates it.
  return lines.join('\r\n')
}

export function downloadCsv(entity: EntitySchema, records: TrackerRecord[]): void {
  const blob = new Blob([recordsToCsv(entity, records)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${entity.sheetName.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}
