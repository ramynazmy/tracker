/**
 * CRUD for any entity tab.
 *
 * Everything here takes an `EntitySchema` and derives the tab, the columns and
 * the audit label from it. There is no per-entity branching, and adding a third
 * entity needs no change to this file.
 */

import type { EntitySchema } from '../config/schema'
import { batchGet, sheetsFetch } from './client'
import { appendAudit } from './audit'
import {
  columnLetter,
  indexHeaders,
  recordToRow,
  rowToRecord,
  type CellValue,
  type HeaderIndex,
  type TrackerRecord,
} from './rows'

/**
 * `A:ZZ`, not `A1:Z`. The `Z` cap silently truncates once the sheet passes 26
 * columns, and the symptom is "my new field isn't loading" rather than an
 * error. Sheets trims trailing empties, so the wider range costs nothing.
 */
export function rangeFor(entity: EntitySchema): string {
  return `${entity.sheetName}!A:ZZ`
}

/** Someone else changed the record between opening the form and saving it. */
export class ConflictError extends Error {
  constructor(readonly current: TrackerRecord) {
    super('This record changed since you opened it')
    this.name = 'ConflictError'
  }
}

export class RecordGoneError extends Error {
  constructor() {
    super('This record no longer exists in the sheet')
    this.name = 'RecordGoneError'
  }
}

export interface SheetSnapshot {
  index: HeaderIndex
  /** 1-based sheet row number per record id, valid only for this snapshot. */
  rowNumbers: Map<string, number>
  records: Map<string, TrackerRecord>
  live: TrackerRecord[]
}

const EMPTY_SNAPSHOT: SheetSnapshot = {
  index: new Map(),
  rowNumbers: new Map(),
  records: new Map(),
  live: [],
}

/**
 * Build a snapshot from values already in hand.
 *
 * Split out from the fetch so the whole app can load from ONE batched read
 * covering every tab, and so this logic is unit-testable without a network.
 */
export function snapshotFromValues(
  entity: EntitySchema,
  rows: readonly (readonly unknown[])[],
): SheetSnapshot {
  const [headerRow, ...dataRows] = rows
  if (!headerRow) {
    return { index: new Map(), rowNumbers: new Map(), records: new Map(), live: [] }
  }

  const index = indexHeaders(headerRow, entity)
  const rowNumbers = new Map<string, number>()
  const records = new Map<string, TrackerRecord>()
  const live: TrackerRecord[] = []

  dataRows.forEach((row, offset) => {
    const record = rowToRecord(row, index, entity)
    // A row with no id is almost always a stray note typed below the data.
    if (!record.id) return

    rowNumbers.set(record.id, offset + 2) // +1 for the header, +1 for 1-based
    records.set(record.id, record)
    if (!record.deleted) live.push(record)
  })

  live.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { index, rowNumbers, records, live }
}

/**
 * One read of the whole tab, yielding both the records and their current row
 * numbers.
 *
 * Row numbers are a coordinate, never an identity: sorting the sheet moves
 * every row. Each write re-takes this snapshot immediately beforehand, so the
 * numbers are seconds old rather than minutes.
 */
export async function snapshotOf(entity: EntitySchema): Promise<SheetSnapshot> {
  const response = await batchGet([rangeFor(entity)])
  const rows = response.valueRanges?.[0]?.values ?? []
  return rows.length === 0 ? EMPTY_SNAPSHOT : snapshotFromValues(entity, rows)
}

export async function listEntity(entity: EntitySchema): Promise<TrackerRecord[]> {
  return (await snapshotOf(entity)).live
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createEntity(
  entity: EntitySchema,
  fields: Record<string, CellValue>,
  actorEmail: string,
): Promise<TrackerRecord> {
  const { index } = await snapshotOf(entity)

  const timestamp = nowIso()
  const record: TrackerRecord = {
    id: crypto.randomUUID(),
    createdAt: timestamp,
    createdBy: actorEmail,
    updatedAt: timestamp,
    updatedBy: actorEmail,
    deleted: false,
    fields,
  }

  await sheetsFetch(
    `/values/${encodeURIComponent(rangeFor(entity))}:append` +
      // INSERT_ROWS is not optional: the default OVERWRITE will write over
      // whatever sits below a blank row — a totals row, a stray note. Silent
      // data loss, hard to trace afterwards.
      '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    {
      method: 'POST',
      body: JSON.stringify({ values: [recordToRow(record, index, entity)] }),
    },
  )

  await appendAudit('create', record.id, actorEmail, summarise(entity, fields))
  return record
}

/**
 * Update a record.
 *
 * `expectedUpdatedAt` is the value the form was opened with. If the sheet has
 * moved on, this throws ConflictError carrying the current state so the caller
 * can offer reload-or-overwrite. Passing `force` skips the check.
 *
 * Honest limit: Sheets has no transactions, so a sub-second race between the
 * check and the write remains. This narrows the window from minutes to
 * milliseconds, which is the right amount of engineering here.
 */
export async function updateEntity(
  entity: EntitySchema,
  id: string,
  fields: Record<string, CellValue>,
  actorEmail: string,
  expectedUpdatedAt: string,
  options: { force?: boolean } = {},
): Promise<TrackerRecord> {
  const { index, rowNumbers, records } = await snapshotOf(entity)

  const rowNumber = rowNumbers.get(id)
  const current = records.get(id)
  if (!rowNumber || !current) throw new RecordGoneError()

  if (!options.force && current.updatedAt !== expectedUpdatedAt) {
    throw new ConflictError(current)
  }

  const updated: TrackerRecord = {
    ...current,
    updatedAt: nowIso(),
    updatedBy: actorEmail,
    fields,
  }

  await writeRow(entity, updated, rowNumber, index)
  await appendAudit('update', id, actorEmail, summarise(entity, fields))
  return updated
}

/**
 * Soft delete: flip the flag and stamp who did it. No deleteDimension — the row
 * survives, which keeps history and avoids a fragile batchUpdate against a row
 * number that could have moved.
 *
 * Nothing cascades. Deleting a feature leaves its actions in place, pointing at
 * an id with no live feature; the Actions page surfaces those as orphans and
 * offers to reassign them. A cascade would be N unbatched writes against a
 * 60-per-minute quota with no transaction to make it all-or-nothing, and a
 * half-completed cascade is worse than a visible orphan.
 */
export async function softDeleteEntity(
  entity: EntitySchema,
  id: string,
  actorEmail: string,
): Promise<void> {
  const { index, rowNumbers, records } = await snapshotOf(entity)

  const rowNumber = rowNumbers.get(id)
  const current = records.get(id)
  if (!rowNumber || !current) throw new RecordGoneError()

  await writeRow(
    entity,
    { ...current, deleted: true, updatedAt: nowIso(), updatedBy: actorEmail },
    rowNumber,
    index,
  )
  await appendAudit('delete', id, actorEmail, summarise(entity, current.fields))
}

/**
 * Write the whole row.
 *
 * The range ends at the last mapped column rather than at ZZ: a PUT whose range
 * is wider than the payload is rejected for a dimension mismatch.
 *
 * Because this writes EVERY cell from column A to the last mapped column, any
 * formula placed inside that span is destroyed the first time someone edits the
 * row. Derived values (the open-action count) are computed in the client and
 * kept out of `entity.fields` precisely so they can never reach this function.
 */
async function writeRow(
  entity: EntitySchema,
  record: TrackerRecord,
  rowNumber: number,
  index: HeaderIndex,
): Promise<void> {
  const values = recordToRow(record, index, entity)
  const end = columnLetter(values.length - 1)
  const range = `${entity.sheetName}!A${rowNumber}:${end}${rowNumber}`

  await sheetsFetch(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [values] }),
  })
}

/**
 * A short human-readable label for the audit log.
 *
 * Keyed on `entity.titleField`, not `fields[0]`: on an action the first field is
 * `featureId`, so a positional lookup would fill the audit log with bare UUIDs.
 * The entity is prefixed rather than given its own Audit column — `Audit!A:E` is
 * a protected range, so widening it needs an admin for no real gain.
 */
function summarise(entity: EntitySchema, fields: Record<string, CellValue>): string {
  const label = fields[entity.titleField]
  return `${entity.key}: ${String(label ?? '').slice(0, 120)}`
}
