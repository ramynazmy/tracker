import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { entities, type EntityKey, type EntitySchema } from '../config/schema'
import {
  createEntity,
  softDeleteEntity,
  updateEntity,
} from '../sheets/collection'
import { loadAppData } from '../sheets/snapshot'
import { parseLists, type Vocabularies } from '../sheets/lists'
import type { CellValue, TrackerRecord } from '../sheets/rows'
import { countOpenActionsByFeature } from '../lib/rollups'
import { TrackerDataContext, type TrackerData } from './TrackerDataContext'

interface State {
  records: Record<EntityKey, TrackerRecord[]>
  vocabularies: Vocabularies
  loading: boolean
  error: Error | null
  loadedAt: Date | null
}

const byUpdatedAtDesc = (a: TrackerRecord, b: TrackerRecord) =>
  b.updatedAt.localeCompare(a.updatedAt)

const EMPTY: State = {
  records: { feature: [], action: [] },
  vocabularies: parseLists([]),
  loading: true,
  error: null,
  loadedAt: null,
}

/**
 * Loads every tab once, in one request, and keeps it in memory.
 *
 * This is a provider rather than a hook because two pages need the same data:
 * a per-component cache would refetch on every navigation between the features
 * list and a feature's detail page, against a 60-read-per-minute quota.
 *
 * Mutations apply optimistically and roll back on failure. Sheets round-trips
 * take 300–800ms, which is long enough to feel broken without this.
 */
export default function TrackerDataProvider({
  actorEmail,
  children,
}: {
  actorEmail: string
  children: ReactNode
}) {
  const [state, setState] = useState<State>(EMPTY)

  // StrictMode double-mounts effects in development; without this the initial
  // load fires twice against a quota-limited API.
  const started = useRef(false)

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await loadAppData()
      setState({
        records: { feature: data.features.live, action: data.actions.live },
        vocabularies: data.vocabularies,
        loading: false,
        error: null,
        loadedAt: new Date(),
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }))
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void refresh()
  }, [refresh])

  /**
   * Apply an optimistic change to one entity's list, run the write, and restore
   * the previous list if it fails. The error is rethrown so the form can show
   * it in context.
   */
  const mutate = useCallback(
    async (
      key: EntityKey,
      optimistic: (records: TrackerRecord[]) => TrackerRecord[],
      write: () => Promise<void>,
    ) => {
      let previous: TrackerRecord[] = []
      setState((prev) => {
        previous = prev.records[key]
        return {
          ...prev,
          records: { ...prev.records, [key]: optimistic(prev.records[key]).sort(byUpdatedAtDesc) },
        }
      })

      try {
        await write()
      } catch (error) {
        setState((prev) => ({ ...prev, records: { ...prev.records, [key]: previous } }))
        throw error
      }
    },
    [],
  )

  const create = useCallback(
    async (entity: EntitySchema, fields: Record<string, CellValue>) => {
      const now = new Date().toISOString()
      // Placeholder id, replaced by the server-assigned record on success. The
      // real UUID is generated inside createEntity.
      const pending: TrackerRecord = {
        id: `pending-${now}`,
        createdAt: now,
        createdBy: actorEmail,
        updatedAt: now,
        updatedBy: actorEmail,
        deleted: false,
        fields,
      }

      let saved: TrackerRecord | null = null
      await mutate(
        entity.key,
        (records) => [pending, ...records],
        async () => {
          saved = await createEntity(entity, fields, actorEmail)
        },
      )

      if (saved) {
        const persisted = saved
        setState((prev) => ({
          ...prev,
          records: {
            ...prev.records,
            [entity.key]: prev.records[entity.key].map((r) =>
              r.id === pending.id ? persisted : r,
            ),
          },
        }))
      }
    },
    [actorEmail, mutate],
  )

  const update = useCallback(
    async (
      entity: EntitySchema,
      record: TrackerRecord,
      fields: Record<string, CellValue>,
      options: { force?: boolean } = {},
    ) => {
      const now = new Date().toISOString()
      await mutate(
        entity.key,
        (records) =>
          records.map((r) =>
            r.id === record.id ? { ...r, fields, updatedAt: now, updatedBy: actorEmail } : r,
          ),
        async () => {
          await updateEntity(entity, record.id, fields, actorEmail, record.updatedAt, options)
        },
      )
    },
    [actorEmail, mutate],
  )

  const remove = useCallback(
    async (entity: EntitySchema, record: TrackerRecord) => {
      await mutate(
        entity.key,
        (records) => records.filter((r) => r.id !== record.id),
        async () => {
          await softDeleteEntity(entity, record.id, actorEmail)
        },
      )
    },
    [actorEmail, mutate],
  )

  const features = state.records.feature
  const actions = state.records.action

  // Recomputed from the optimistic list, so closing an action updates its
  // feature's count immediately — no refetch, no formula.
  const openActionCounts = useMemo(() => countOpenActionsByFeature(actions), [actions])

  const featureNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const feature of features) {
      names.set(feature.id, String(feature.fields[entities.feature.titleField] ?? ''))
    }
    return names
  }, [features])

  const recordsOf = useCallback(
    (entity: EntitySchema) => state.records[entity.key],
    [state.records],
  )

  const value: TrackerData = {
    features,
    actions,
    vocabularies: state.vocabularies,
    openActionCounts,
    featureNames,
    loading: state.loading,
    error: state.error,
    loadedAt: state.loadedAt,
    refresh,
    recordsOf,
    create,
    update,
    remove,
  }

  return <TrackerDataContext.Provider value={value}>{children}</TrackerDataContext.Provider>
}
