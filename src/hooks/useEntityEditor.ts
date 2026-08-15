import { useState } from 'react'
import type { EntitySchema } from '../config/schema'
import { useTracker } from '../data/TrackerDataContext'
import { SheetsError } from '../sheets/client'
import type { CellValue, TrackerRecord } from '../sheets/rows'
import { ACCESS_CHANGED_MESSAGE } from '../lib/permissions'

export type Editing =
  | { mode: 'new'; locked?: Record<string, CellValue> }
  | { mode: 'edit'; record: TrackerRecord }
  | null

/**
 * The open-form / save / delete cycle, shared by every page that edits records.
 *
 * Pulled out because all three pages need identical behaviour including the
 * 403 handling, and a page that got that subtly wrong would offer a button
 * Google refuses without explaining why.
 */
export function useEntityEditor(entity: EntitySchema) {
  const { create, update, remove, refresh } = useTracker()
  const [editing, setEditing] = useState<Editing>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function save(fields: Record<string, CellValue>, options: { force?: boolean }) {
    if (!editing) return
    if (editing.mode === 'new') await create(entity, fields)
    else await update(entity, editing.record, fields, options)
    setEditing(null)
  }

  async function destroy(record: TrackerRecord) {
    try {
      await remove(entity, record)
    } catch (failure) {
      // A 403 here means the Users-tab role and the Drive sharing level have
      // drifted apart: the app offered a button Google will not honour.
      setToast(
        failure instanceof SheetsError && failure.isForbidden
          ? ACCESS_CHANGED_MESSAGE
          : failure instanceof Error
            ? failure.message
            : String(failure),
      )
    }
  }

  function cancel() {
    setEditing(null)
    // A conflict resolved by "Reload theirs" needs fresh data.
    void refresh()
  }

  return { editing, setEditing, toast, setToast, save, destroy, cancel }
}
