/**
 * The whole app's data in ONE request.
 *
 * `batchGet` takes several ranges, so features, actions and the vocabularies
 * arrive together for the cost of a single call against a 60-read-per-minute
 * quota. Loading them separately would triple that for no benefit — they are
 * always needed together, because rendering an action means resolving both its
 * feature and its status label.
 *
 * Users is deliberately NOT here: GoogleAuthProvider already reads it once
 * during sign-in, before any page renders.
 */

import { entities } from '../config/schema'
import { batchGet } from './client'
import { rangeFor, snapshotFromValues, type SheetSnapshot } from './collection'
import { LISTS_RANGE, parseLists, type Vocabularies } from './lists'

/**
 * Order matters: the response's valueRanges come back in request order, and
 * that is what they are read by below.
 */
export const APP_RANGES = [
  rangeFor(entities.feature),
  rangeFor(entities.action),
  LISTS_RANGE,
] as const

export interface AppData {
  features: SheetSnapshot
  actions: SheetSnapshot
  vocabularies: Vocabularies
}

export async function loadAppData(): Promise<AppData> {
  const response = await batchGet([...APP_RANGES])
  const ranges = response.valueRanges ?? []

  return {
    features: snapshotFromValues(entities.feature, ranges[0]?.values ?? []),
    actions: snapshotFromValues(entities.action, ranges[1]?.values ?? []),
    vocabularies: parseLists(ranges[2]?.values ?? []),
  }
}
