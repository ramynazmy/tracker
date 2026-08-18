import { useEffect, useRef, useState } from 'react'
import type { EntitySchema, Field } from '../config/schema'
import { hasErrors, validateFields, type FieldErrors } from '../lib/validate'
import { optionsFor, type Vocabularies } from '../sheets/lists'
import type { CellValue, TrackerRecord } from '../sheets/rows'
import { ConflictError } from '../sheets/collection'
import FieldInput, { type Choice } from './FieldInput'

interface Props {
  entity: EntitySchema
  /** Absent for a new record. */
  record?: TrackerRecord
  /**
   * The fields to show, when not the whole entity — e.g. the event variant of
   * an action. Hidden fields keep the record's existing values on save; only
   * the shown fields are validated, so a variant can drop a required field.
   */
  fields?: readonly Field[]
  /** Dialog heading override, e.g. "New event" over "New action". */
  title?: string
  vocabularies: Vocabularies
  /** Choices for `link` fields, keyed by field key. */
  linkChoices?: Record<string, readonly Choice[]>
  /** Values pre-filled and locked, e.g. featureId when adding from a feature. */
  locked?: Record<string, CellValue>
  onCancel: () => void
  onSave: (fields: Record<string, CellValue>, options: { force?: boolean }) => Promise<void>
}

function initialValues(
  entity: EntitySchema,
  record?: TrackerRecord,
  locked?: Record<string, CellValue>,
): Record<string, CellValue> {
  const values: Record<string, CellValue> = {}
  for (const field of entity.fields) values[field.key] = record?.fields[field.key] ?? null
  return { ...values, ...locked }
}

export default function EntityForm({
  entity,
  record,
  fields,
  title,
  vocabularies,
  linkChoices,
  locked,
  onCancel,
  onSave,
}: Props) {
  const shown = fields ?? entity.fields
  // Values still span ALL of the entity's fields: a variant that hides a field
  // must carry its existing value through the save untouched, not blank it.
  const [values, setValues] = useState(() => initialValues(entity, record, locked))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TrackerRecord | null>(null)

  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [])

  async function submit(force = false) {
    const found = validateFields(shown, values)
    setErrors(found)
    if (hasErrors(found)) return

    setSaving(true)
    setFailure(null)
    try {
      await onSave(values, { force })
    } catch (error) {
      if (error instanceof ConflictError) {
        setConflict(error.current)
      } else {
        setFailure(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Changing a field that scopes another one clears the dependent value.
   *
   * Moving a feature to a different channel must not leave it holding the
   * previous channel's release id — that pair is invalid, and nothing
   * downstream rejects it, because references deliberately never hard-fail.
   */
  function change(field: Field, value: CellValue) {
    setValues((prev) => {
      const next = { ...prev, [field.key]: value }
      for (const dependent of entity.fields) {
        if (dependent.scopeBy === field.key && prev[dependent.key]) {
          next[dependent.key] = null
        }
      }
      return next
    })
  }

  function choicesFor(field: Field): readonly Choice[] | undefined {
    if (field.type === 'link') return linkChoices?.[field.key] ?? []
    if (field.type !== 'reference') return undefined
    const scope = field.scopeBy ? values[field.scopeBy] : undefined
    return optionsFor(vocabularies, field, scope).map((item) => ({
      value: item.id,
      label: item.label,
    }))
  }

  if (conflict) {
    return (
      <Backdrop onCancel={onCancel}>
        <div className="dialog" ref={dialog}>
          <h2>This record changed since you opened it</h2>
          <p className="muted">
            Last edited by <code>{conflict.updatedBy || 'someone else'}</code> at{' '}
            {new Date(conflict.updatedAt).toLocaleString()}.
          </p>
          <p className="muted">
            Reload to see their version and lose your edits, or overwrite it with yours.
          </p>
          <div className="dialog__actions">
            <button className="btn" onClick={onCancel} disabled={saving}>
              Reload theirs
            </button>
            <button className="btn btn--primary" onClick={() => void submit(true)} disabled={saving}>
              {saving ? 'Overwriting…' : 'Overwrite'}
            </button>
          </div>
        </div>
      </Backdrop>
    )
  }

  return (
    <Backdrop onCancel={onCancel}>
      <div className="dialog" ref={dialog}>
        <h2>
          {title ??
            (record ? `Edit ${entity.label.toLowerCase()}` : `New ${entity.label.toLowerCase()}`)}
        </h2>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {shown.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key] ?? null}
              error={errors[field.key]}
              choices={choicesFor(field)}
              disabled={locked ? field.key in locked : false}
              baseDate={field.daysFrom ? String(values[field.daysFrom] ?? '') : undefined}
              onChange={(value) => change(field, value)}
            />
          ))}

          {failure && (
            <div className="card card--warn">
              <p>{failure}</p>
            </div>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </Backdrop>
  )
}

function Backdrop({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      {children}
    </div>
  )
}
