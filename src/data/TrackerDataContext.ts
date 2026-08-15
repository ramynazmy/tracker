import { createContext, useContext } from 'react'
import type { EntitySchema } from '../config/schema'
import type { Vocabularies } from '../sheets/lists'
import type { CellValue, TrackerRecord } from '../sheets/rows'

export interface TrackerData {
  features: TrackerRecord[]
  actions: TrackerRecord[]
  vocabularies: Vocabularies
  /** featureId → open action count. Computed, never read from the sheet. */
  openActionCounts: ReadonlyMap<string, number>
  /** featureId → feature name, for rendering an action's link column. */
  featureNames: ReadonlyMap<string, string>

  loading: boolean
  error: Error | null
  /** Wall-clock of the last successful load, for the "as of" label. */
  loadedAt: Date | null

  refresh: () => Promise<void>
  recordsOf: (entity: EntitySchema) => TrackerRecord[]
  create: (entity: EntitySchema, fields: Record<string, CellValue>) => Promise<void>
  update: (
    entity: EntitySchema,
    record: TrackerRecord,
    fields: Record<string, CellValue>,
    options?: { force?: boolean },
  ) => Promise<void>
  remove: (entity: EntitySchema, record: TrackerRecord) => Promise<void>
}

export const TrackerDataContext = createContext<TrackerData | null>(null)

export function useTracker(): TrackerData {
  const value = useContext(TrackerDataContext)
  if (!value) throw new Error('useTracker must be used inside <TrackerDataProvider>')
  return value
}
