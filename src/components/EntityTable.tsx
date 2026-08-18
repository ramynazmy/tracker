import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { EntitySchema, Field } from '../config/schema'
import { isUnknownValue, labelFor, type Vocabularies } from '../sheets/lists'
import type { CellValue, TrackerRecord } from '../sheets/rows'

/**
 * A column computed from the record rather than stored on it.
 *
 * These exist so a rollup like the open-action count can be shown WITHOUT
 * being a schema field. A schema field would be written back to the sheet by
 * `recordToRow`; a derived column cannot be, because it never enters the write
 * path. That is the structural reason the workbook's `Open Actions` formula
 * has no equivalent in the Features tab.
 */
export interface DerivedColumn {
  key: string
  label: string
  value: (record: TrackerRecord) => CellValue
}

/**
 * A listColumns entry with no matching field is simply dropped.
 *
 * Deliberately a function of the entity rather than a module constant: a
 * constant is evaluated once at import, so the moment a second entity renders
 * through this component it would silently draw the first entity's columns —
 * no type error, no runtime error, just the wrong table.
 */
export function resolveColumns(entity: EntitySchema): Field[] {
  return entity.listColumns.flatMap((key) => {
    const field = entity.fields.find((f) => f.key === key)
    return field ? [field] : []
  })
}

type SortDir = 'asc' | 'desc'

interface Props {
  entity: EntitySchema
  records: TrackerRecord[]
  vocabularies: Vocabularies
  /** UUID → display label, for `link` columns. */
  linkLabels?: ReadonlyMap<string, string>
  derived?: readonly DerivedColumn[]
  /** Makes the first cell a link to the record's own page. */
  rowHref?: (record: TrackerRecord) => string
  /**
   * Extra class for a whole row — how the actions table tones a row by its
   * due state without this component knowing what a due date is.
   */
  rowClass?: (record: TrackerRecord) => string | undefined
  /** False for viewers: the column is omitted, not merely disabled. */
  canWrite: boolean
  onEdit: (record: TrackerRecord) => void
  onDelete: (record: TrackerRecord) => void
  emptyMessage?: string
}

export default function EntityTable({
  entity,
  records,
  vocabularies,
  linkLabels,
  derived = [],
  rowHref,
  rowClass,
  canWrite,
  onEdit,
  onDelete,
  emptyMessage,
}: Props) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const columns = useMemo(() => resolveColumns(entity), [entity])

  /** Everything a row can be searched by, including resolved labels. */
  const searchText = useMemo(() => {
    const text = new Map<string, string>()
    for (const record of records) {
      const parts: string[] = []
      for (const field of entity.fields) {
        const raw = record.fields[field.key]
        if (raw === null || raw === undefined || raw === '') continue
        parts.push(String(raw))
        // Also index what the user actually SEES. Without this, searching the
        // actions table for a feature name finds nothing, because the cell
        // holds a UUID.
        if (field.type === 'reference' && field.listKind) {
          parts.push(labelFor(vocabularies, field.listKind, String(raw)))
        } else if (field.type === 'link') {
          parts.push(linkLabels?.get(String(raw)) ?? '')
        }
      }
      text.set(record.id, parts.join(' ').toLowerCase())
    }
    return text
  }, [records, entity, vocabularies, linkLabels])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? records.filter((record) => (searchText.get(record.id) ?? '').includes(needle))
      : records

    if (!sortKey) return matched

    const derivedColumn = derived.find((d) => d.key === sortKey)
    const valueOf = derivedColumn
      ? derivedColumn.value
      : (record: TrackerRecord) => record.fields[sortKey] ?? null

    const direction = sortDir === 'asc' ? 1 : -1
    return [...matched].sort((a, b) => compare(valueOf(a), valueOf(b)) * direction)
  }, [records, query, sortKey, sortDir, searchText, derived])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const heading = (key: string, label: string) => (
    <th key={key}>
      <button className="th-sort" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key && <span aria-hidden>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  )

  return (
    <>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder={`Search ${entity.labelPlural.toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted">
          {visible.length} of {records.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="muted">
          {records.length === 0
            ? (emptyMessage ?? `No ${entity.labelPlural.toLowerCase()} yet.`)
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="records">
            <thead>
              <tr>
                {columns.map((field) => heading(field.key, field.label))}
                {derived.map((column) => heading(column.key, column.label))}
                {canWrite && <th className="records__actions" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id} className={rowClass?.(record)}>
                  {columns.map((field, position) => (
                    <td key={field.key} className={`cell cell--${field.type}`}>
                      {position === 0 && rowHref ? (
                        <Link to={rowHref(record)}>
                          {renderCell(record.fields[field.key] ?? null, field, vocabularies, linkLabels)}
                        </Link>
                      ) : (
                        renderCell(record.fields[field.key] ?? null, field, vocabularies, linkLabels)
                      )}
                    </td>
                  ))}
                  {derived.map((column) => (
                    <td key={column.key} className="cell cell--number">
                      {renderPlain(column.value(record))}
                    </td>
                  ))}
                  {canWrite && (
                    <td className="records__actions">
                      <button className="btn btn--link" onClick={() => onEdit(record)}>
                        Edit
                      </button>
                      {/* No window.confirm: a native dialog blocks the page and,
                          since deletes here are soft, the row is recoverable. */}
                      <button
                        className="btn btn--link btn--danger"
                        onClick={() => onDelete(record)}
                        title="Soft delete — the row is kept in the sheet"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Nulls always sort last, whichever direction — empty cells at the bottom. */
function compare(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function renderPlain(value: CellValue) {
  if (value === null || value === '') return <span className="muted">—</span>
  return String(value)
}

export function renderCell(
  value: CellValue,
  field: Field,
  vocabularies: Vocabularies,
  linkLabels?: ReadonlyMap<string, string>,
) {
  if (value === null || value === '') return <span className="muted">—</span>
  const text = String(value)

  if (field.type === 'reference' && field.listKind) {
    // A value the Lists tab has never heard of means somebody typed into the
    // sheet directly. Show it, flagged, rather than hiding the discrepancy.
    // A RETIRED value is not flagged — it is known, just no longer offered.
    const unknown = isUnknownValue(vocabularies, field.listKind, text)
    return (
      <span className={unknown ? 'chip chip--unknown' : 'chip'}>
        {labelFor(vocabularies, field.listKind, text)}
      </span>
    )
  }

  if (field.type === 'link') {
    const label = linkLabels?.get(text)
    return label ? (
      <span className="chip">{label}</span>
    ) : (
      <span className="chip chip--unknown" title={text}>
        Unknown {field.label.toLowerCase()}
      </span>
    )
  }

  if (field.type === 'select') {
    const known = field.options?.includes(text) ?? true
    return <span className={known ? 'chip' : 'chip chip--unknown'}>{text}</span>
  }

  return text
}
