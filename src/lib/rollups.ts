/**
 * Derived numbers, computed in the client.
 *
 * The workbook did these with formulas — `COUNTIFS(Actions!$B:$B, $E3, …)` in
 * the Tracker tab. They must NOT come back as formulas here: the app writes
 * whole rows from column A to the last mapped column, so a formula anywhere in
 * that span is overwritten with '' the first time anyone edits that row.
 *
 * Everything here is pure and takes the records it needs, which is what keeps
 * these values out of `entity.fields` and therefore out of the write path.
 */

import type { TrackerRecord } from '../sheets/rows'

/**
 * A status meaning the action needs no more work.
 *
 * Deliberately a negative test — "not done, not cancelled" — rather than the
 * workbook's positive `Open` OR `In Progress`. The action statuses are editable
 * data now: the moment somebody adds "Blocked" to the Lists tab, a positive
 * test silently stops counting those actions, and a rollup that quietly
 * under-reports is worse than one that over-reports. A blank status counts as
 * open for the same reason.
 */
const CLOSED = new Set(['done', 'cancelled'])

function statusOf(action: TrackerRecord): string {
  return String(action.fields.status ?? '').trim().toLowerCase()
}

export function isOpenAction(action: TrackerRecord): boolean {
  return !CLOSED.has(statusOf(action))
}

/** featureId → number of open actions. Features with none are absent. */
export function countOpenActionsByFeature(
  actions: readonly TrackerRecord[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const action of actions) {
    if (!isOpenAction(action)) continue
    const featureId = String(action.fields.featureId ?? '')
    if (!featureId) continue
    counts.set(featureId, (counts.get(featureId) ?? 0) + 1)
  }
  return counts
}

export function actionsForFeature(
  actions: readonly TrackerRecord[],
  featureId: string,
): TrackerRecord[] {
  return actions.filter((a) => String(a.fields.featureId ?? '') === featureId)
}

/**
 * Actions pointing at no live feature — a blank link, or a feature that was
 * deleted out from under them.
 *
 * These are surfaced rather than hidden. The workbook's name-based join made
 * them vanish silently on a rename; making them visible is the entire point of
 * moving to a UUID key.
 */
export function orphanActions(
  actions: readonly TrackerRecord[],
  liveFeatureIds: ReadonlySet<string>,
): TrackerRecord[] {
  return actions.filter((a) => {
    const featureId = String(a.fields.featureId ?? '')
    return !featureId || !liveFeatureIds.has(featureId)
  })
}

/** Whole days a due date is past, or null when it is not overdue. */
export function daysOverdue(action: TrackerRecord, today: Date): number | null {
  if (!isOpenAction(action)) return null
  const due = String(action.fields.dueDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null

  const [year, month, day] = due.split('-').map(Number) as [number, number, number]
  // UTC on both sides, matching the date handling in rows.ts. Local time would
  // make an action tip into "overdue" at a different moment per timezone.
  const dueMs = Date.UTC(year, month - 1, day)
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const days = Math.round((todayMs - dueMs) / 86_400_000)
  return days > 0 ? days : null
}

/** Counts by a field's value, for the deferred dashboard. */
export function countBy(
  records: readonly TrackerRecord[],
  key: string,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const value = String(record.fields[key] ?? '')
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}
