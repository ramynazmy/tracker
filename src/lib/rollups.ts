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
 * Is this row work the team owes?
 *
 * The Actions tab holds the whole timeline, including things other people do —
 * a delivery milestone, a vendor deliverable. Those are context, not workload.
 * Counting them would inflate every feature's open-action rollup and the
 * overdue figure into meaning nothing in particular.
 *
 * `owned` comes from the Lists tab via `ownedActorIds`, so which actors count
 * as ours is data, not code. It is a required argument rather than an optional
 * one on purpose: a default would let a call site quietly skip it and still be
 * right today, then be wrong the moment the set changes.
 *
 * Blank counts as ours: the field was added after the fact, and treating a
 * blank as somebody else's would zero every existing rollup at once.
 */
export function isOwnedAction(action: TrackerRecord, owned: ReadonlySet<string>): boolean {
  const actor = String(action.fields.actor ?? '').trim()
  return actor === '' || owned.has(actor)
}

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

/**
 * featureId → number of open actions the architecture team owes.
 *
 * Deliberately excludes rows performed by anyone else. This column answers
 * "how much is outstanding on us for this feature", and a delivery milestone
 * sitting in the same tab is not an answer to that question.
 */
export function countOpenActionsByFeature(
  actions: readonly TrackerRecord[],
  owned: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const action of actions) {
    if (!isOpenAction(action) || !isOwnedAction(action, owned)) continue
    const featureId = String(action.fields.featureId ?? '')
    if (!featureId) continue
    counts.set(featureId, (counts.get(featureId) ?? 0) + 1)
  }
  return counts
}

/**
 * Features with an action currently being worked — the dashboard's other way
 * of qualifying as active besides a dated moment in the window.
 *
 * Keys on the literal `in-progress` id, the same way releases.ts keys on
 * `done`: a status the vocabulary grows beyond these simply does not qualify,
 * which errs toward showing less rather than guessing.
 */
export function inProgressFeatureIds(actions: readonly TrackerRecord[]): Set<string> {
  const ids = new Set<string>()
  for (const action of actions) {
    if (statusOf(action) !== 'in-progress') continue
    const featureId = String(action.fields.featureId ?? '')
    if (featureId) ids.add(featureId)
  }
  return ids
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

export type DueTone = 'late' | 'open' | 'done'

/**
 * How an action's due date should read at a glance, everywhere one is shown:
 * `late` (red) — past due and still open; `open` (yellow) — due but not yet
 * missed; `done` (green) — closed, the date no longer asks for anything.
 *
 * Null means "no colour": an event — work someone else performs — is context,
 * and a traffic light on somebody else's milestone would say we owe it. Also
 * null for a blank or malformed date, which has nothing to be on time for.
 *
 * Due today is `open`, not `late`, matching daysOverdue and the timeline: the
 * day is not over.
 */
export function dueTone(
  action: TrackerRecord,
  todayIso: string,
  owned: ReadonlySet<string>,
): DueTone | null {
  if (!isOwnedAction(action, owned)) return null
  const due = String(action.fields.dueDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  if (!isOpenAction(action)) return 'done'
  return due < todayIso ? 'late' : 'open'
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
