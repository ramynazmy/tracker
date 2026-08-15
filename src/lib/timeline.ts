/**
 * The timeline: what has happened and what is coming, in date order.
 *
 * Built entirely from actions, because actions are where the dates live. An
 * action contributes up to two entries — the day it was raised, and the day it
 * is due — so a single row can appear twice in the chronology, which is
 * correct: those are two different moments.
 *
 * Pure, and takes `today` rather than reading the clock, so the boundary cases
 * are testable.
 */

import type { TrackerRecord } from '../sheets/rows'
import { isOpenAction } from './rollups'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type EntryKind = 'raised' | 'due'

export interface TimelineEntry {
  /** Stable across renders: an action yields at most one entry per kind. */
  key: string
  date: string
  kind: EntryKind
  action: TrackerRecord
  /** Strictly before today. Drives past-vs-future rendering. */
  past: boolean
  /** Due, in the past, and still open. Only ever true for a `due` entry. */
  overdue: boolean
}

function isoOf(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return ISO_DATE.test(text) ? text : null
}

/**
 * Every dated moment across these actions, oldest first.
 *
 * Malformed dates are skipped rather than guessed at — the source workbook
 * contains a due date typed `1508/2026`, and inventing a position for it on a
 * timeline would be worse than leaving it off one.
 */
export function buildTimeline(
  actions: readonly TrackerRecord[],
  today: string,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const action of actions) {
    const raised = isoOf(action.fields.raisedOn)
    if (raised) {
      entries.push({
        key: `${action.id}:raised`,
        date: raised,
        kind: 'raised',
        action,
        past: raised <= today,
        overdue: false,
      })
    }

    const due = isoOf(action.fields.dueDate)
    if (due) {
      entries.push({
        key: `${action.id}:due`,
        date: due,
        kind: 'due',
        action,
        past: due <= today,
        // A due date that has passed on finished work is history, not a
        // problem — only open work can be overdue.
        overdue: due < today && isOpenAction(action),
      })
    }
  }

  // ISO dates sort correctly as strings. Raised before due on the same day,
  // because something is raised before it can fall due — spelled out rather
  // than left to localeCompare, which would put "due" first alphabetically.
  const order: Record<EntryKind, number> = { raised: 0, due: 1 }
  return entries.sort(
    (a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind],
  )
}

export interface TimelineMonth {
  /** `2026-08`, for keying and for the heading. */
  month: string
  entries: TimelineEntry[]
}

/** Group consecutive entries by month, preserving order. */
export function groupByMonth(entries: readonly TimelineEntry[]): TimelineMonth[] {
  const months: TimelineMonth[] = []
  for (const entry of entries) {
    const month = entry.date.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.month === month) last.entries.push(entry)
    else months.push({ month, entries: [entry] })
  }
  return months
}

/** `2026-08` → `August 2026`. UTC, matching every other date in the app. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
