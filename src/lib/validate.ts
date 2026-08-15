import type { EntitySchema, Field } from '../config/schema'
import type { CellValue } from '../sheets/rows'

export type FieldErrors = Record<string, string>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validation driven entirely by schema.ts, so adding a field brings its rules
 * with it. Runs before every write; errors are shown inline on the field.
 */
export function validateRecord(
  entity: EntitySchema,
  values: Record<string, CellValue>,
): FieldErrors {
  const errors: FieldErrors = {}

  for (const field of entity.fields) {
    const error = validateField(values[field.key] ?? null, field)
    if (error) errors[field.key] = error
  }

  return errors
}

export function validateField(value: CellValue, field: Field): string | null {
  const blank = value === null || value === undefined || String(value).trim() === ''

  if (blank) return field.required ? `${field.label} is required` : null

  const text = String(value).trim()

  if (field.maxLength && text.length > field.maxLength) {
    return `${field.label} must be ${field.maxLength} characters or fewer`
  }

  switch (field.type) {
    case 'number': {
      const n = Number(text)
      if (!Number.isFinite(n)) return `${field.label} must be a number`
      if (field.min !== undefined && n < field.min) return `${field.label} must be at least ${field.min}`
      if (field.max !== undefined && n > field.max) return `${field.label} must be at most ${field.max}`
      return null
    }
    case 'date': {
      if (!ISO_DATE.test(text)) return `${field.label} must be a date`
      // Rejects 2026-02-30, which the regex alone would accept.
      const [year, month, day] = text.split('-').map(Number) as [number, number, number]
      const parsed = new Date(Date.UTC(year, month - 1, day))
      const valid =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      return valid ? null : `${field.label} is not a real date`
    }
    case 'email':
      return EMAIL.test(text) ? null : `${field.label} must be an email address`
    case 'select':
      return !field.options || field.options.includes(text)
        ? null
        : `${field.label} must be one of: ${field.options.join(', ')}`
    /**
     * `reference` warns, never rejects — deliberately unlike `select` above.
     *
     * A reference's vocabulary is editable data in the Lists tab, outside this
     * app's control. If an admin retires "R2.5" at 10:00, rejecting unknown
     * values would stop an editor at 10:01 from changing the *Owner* on any of
     * the six features that carry it: a stranger's edit silently locking your
     * unrelated one. The table flags the value and the form keeps it
     * selectable; `required` and `maxLength` still apply.
     *
     * `link` holds a UUID. Whether it resolves to a live record cannot be
     * checked without reading another tab, and validation has no business doing
     * I/O — orphans are surfaced in the UI instead.
     */
    case 'reference':
    case 'link':
      return null
    default:
      return null
  }
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}
