import { useEffect, useState } from 'react'
import type { Field } from '../config/schema'
import { shiftDays } from '../lib/activity'
import type { CellValue } from '../sheets/rows'

/** One selectable value. `value` is what gets stored, `label` what is read. */
export interface Choice {
  value: string
  label: string
}

interface Props {
  field: Field
  value: CellValue
  error?: string
  /**
   * Options for a `select`, `reference` or `link`. Supplied by the caller
   * because references resolve against the Lists tab and links against another
   * entity — neither of which this component should know how to read.
   */
  choices?: readonly Choice[]
  /** A link preset by the page it was opened from, e.g. a feature's own id. */
  disabled?: boolean
  /**
   * For a date field with `daysFrom`: the current value of the field the day
   * count is measured from. Supplied by the form, which holds the other values.
   */
  baseDate?: string
  onChange: (value: CellValue) => void
}

const CHOICE_TYPES = new Set(['select', 'reference', 'link'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** UTC, matching every other date in the app. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** One input per schema field type — the whole form is generated from this. */
export default function FieldInput({
  field,
  value,
  error,
  choices,
  disabled,
  baseDate,
  onChange,
}: Props) {
  const id = `field-${field.key}`
  const text = value === null || value === undefined ? '' : String(value)
  const describedBy = error ? `${id}-error` : undefined

  // "Due in N days" — display state only; what gets stored is always the
  // computed date, so the sheet and everything downstream see a plain date.
  const [days, setDays] = useState('')
  const base = baseDate && ISO_DATE.test(baseDate) ? baseDate : todayIso()

  // If the user said "10 days" and then moves the start date, the due date
  // follows. Deliberately keyed on the base alone: onChange is a fresh closure
  // every render, and depending on it would re-store the value in a loop.
  useEffect(() => {
    if (!field.daysFrom || days === '') return
    const n = Number(days)
    if (Number.isInteger(n) && n >= 0) onChange(shiftDays(base, n))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  const options: readonly Choice[] =
    choices ?? field.options?.map((option) => ({ value: option, label: option })) ?? []
  const unlisted = CHOICE_TYPES.has(field.type) && text !== '' && !options.some((o) => o.value === text)

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required && <span className="field__required" aria-hidden> *</span>}
      </label>

      {renderControl()}

      {unlisted && (
        <p className="field__hint">
          Not in the current list — kept as it is unless you change it.
        </p>
      )}

      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )

  function renderControl() {
    const common = {
      id,
      className: error ? 'input input--error' : 'input',
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy,
    }

    switch (field.type) {
      case 'longtext':
        return (
          <textarea
            {...common}
            rows={4}
            value={text}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
          />
        )

      // One branch for all three: they differ only in where the caller found
      // the choices, not in how the control behaves.
      case 'select':
      case 'reference':
      case 'link':
        return (
          <select
            {...common}
            value={text}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">—</option>
            {/* A value already in the sheet but outside the list still needs to
                be selectable, or editing an unrelated field would silently
                rewrite it. This is the difference between a retired value and
                a lost one. */}
            {unlisted && <option value={text}>{text}</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )

      case 'number':
        return (
          <input
            {...common}
            type="number"
            value={text}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
        )

      case 'date': {
        const picker = (
          <input
            {...common}
            type="date"
            value={text}
            onChange={(e) => {
              // A hand-picked date supersedes the day count.
              setDays('')
              onChange(e.target.value || null)
            }}
          />
        )
        if (!field.daysFrom) return picker
        return (
          <div className="field__days">
            {picker}
            <span className="muted">or in</span>
            <input
              className="input field__days-count"
              type="number"
              min={0}
              value={days}
              aria-label={`${field.label} in days`}
              onChange={(e) => {
                const next = e.target.value
                setDays(next)
                const n = Number(next)
                if (next !== '' && Number.isInteger(n) && n >= 0) {
                  onChange(shiftDays(base, n))
                }
              }}
            />
            <span className="muted">days</span>
          </div>
        )
      }

      case 'email':
        return (
          <input
            {...common}
            type="email"
            value={text}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )

      default:
        return (
          <input
            {...common}
            type="text"
            value={text}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )
    }
  }
}
