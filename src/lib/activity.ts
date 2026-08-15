/**
 * Which features have had something happen to them lately.
 *
 * "Something happened" means a dated moment on one of the feature's actions —
 * it was raised, or it fell due — inside the window. Deliberately NOT the
 * record's `updatedAt`: every row carries the migration timestamp, so that
 * would have reported all 108 features as active on day one and then decayed
 * into meaning "who edited a cell" rather than "what moved".
 *
 * Events count the same as actions, because in this model an event IS an
 * action — one with a non-architecture actor. A delivery milestone landing is
 * exactly the kind of movement this is meant to surface.
 */

import type { TrackerRecord } from '../sheets/rows'
import { buildTimeline, type TimelineEntry } from './timeline'

export const ACTIVE_WINDOW_DAYS = 14

/** Shift an ISO date by whole days, in UTC like every other date here. */
export function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export interface FeatureActivity {
  featureId: string
  /** The most recent dated moment inside the window. */
  latest: TimelineEntry
  count: number
}

/**
 * Activity per feature within the last `days`, most recently active first.
 *
 * The window is inclusive of both ends and reaches back `days - 1` from today,
 * so "the last 14 days" spans fourteen dates rather than fifteen.
 */
export function recentActivity(
  actions: readonly TrackerRecord[],
  today: string,
  days: number = ACTIVE_WINDOW_DAYS,
): FeatureActivity[] {
  const from = shiftDays(today, -(days - 1))
  const byFeature = new Map<string, FeatureActivity>()

  for (const entry of buildTimeline(actions, today)) {
    if (entry.date < from || entry.date > today) continue

    const featureId = String(entry.action.fields.featureId ?? '')
    if (!featureId) continue

    const existing = byFeature.get(featureId)
    if (!existing) {
      byFeature.set(featureId, { featureId, latest: entry, count: 1 })
      continue
    }
    existing.count += 1
    // buildTimeline returns oldest first, so a later entry always wins.
    existing.latest = entry
  }

  return [...byFeature.values()].sort(
    (a, b) => b.latest.date.localeCompare(a.latest.date),
  )
}

export function activeFeatureIds(
  actions: readonly TrackerRecord[],
  today: string,
  days: number = ACTIVE_WINDOW_DAYS,
): Set<string> {
  return new Set(recentActivity(actions, today, days).map((a) => a.featureId))
}
