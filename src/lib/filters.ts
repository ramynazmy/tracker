/**
 * Filtering a record list by its reference fields.
 *
 * Pure and separate from the URL plumbing in `useEntityFilters`, so the
 * matching rules are testable without a router.
 */

import type { EntitySchema, Field } from '../config/schema'
import type { TrackerRecord } from '../sheets/rows'

/** Selected values, keyed by field. An absent or empty value means "any". */
export type FilterValues = Record<string, string>

/**
 * Matches records whose value is empty.
 *
 * Needed because "not set" is a real answer people look for — 25 features have
 * no release — and an empty string already means "no filter". Prefixed so it
 * can never collide with a Lists id, which is always a slug.
 */
export const NOT_SET = '!none'

/** Only fields with a bounded set of values make sensible filters. */
export function filterableFields(entity: EntitySchema): Field[] {
  return entity.fields.filter((f) => f.type === 'reference')
}

export function applyFilters(
  records: readonly TrackerRecord[],
  values: FilterValues,
): TrackerRecord[] {
  const active = Object.entries(values).filter(([, v]) => v !== '' && v !== undefined)
  if (active.length === 0) return [...records]

  return records.filter((record) =>
    active.every(([key, wanted]) => {
      const actual = String(record.fields[key] ?? '').trim()
      return wanted === NOT_SET ? actual === '' : actual === wanted
    }),
  )
}

/** How many filters are narrowing the list, for the "clear" affordance. */
export function activeFilterCount(values: FilterValues): number {
  return Object.values(values).filter((v) => v !== '' && v !== undefined).length
}
