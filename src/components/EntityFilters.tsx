import { useSearchParams } from 'react-router-dom'
import type { Field } from '../config/schema'
import { optionsFor, vocabularyOf, type Vocabularies } from '../sheets/lists'
import { activeFilterCount, NOT_SET, type FilterValues } from '../lib/filters'

/**
 * Filter state lives in the URL.
 *
 * That is what lets the dashboard link to `#/features?channel=retail-banking`
 * and land on the rows behind a number, and it makes a filtered view something
 * you can send to someone. HashRouter puts the query after the hash path, which
 * `useSearchParams` handles unchanged.
 */
export function useEntityFilters(fields: readonly Field[]): {
  values: FilterValues
  setValue: (key: string, value: string) => void
  clear: () => void
  count: number
} {
  const [params, setParams] = useSearchParams()

  const values: FilterValues = {}
  for (const field of fields) {
    values[field.key] = params.get(field.key) ?? ''
  }

  function setValue(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    // Replace, not push: dragging three dropdowns should not mean three taps
    // of the back button to get out.
    setParams(next, { replace: true })
  }

  function clear() {
    const next = new URLSearchParams(params)
    for (const key of Object.keys(values)) next.delete(key)
    setParams(next, { replace: true })
  }

  return { values, setValue, clear, count: activeFilterCount(values) }
}

interface Props {
  /** Which fields to offer. Callers may mix fields from more than one entity —
      the timeline filters by a feature's channel and an action's actor. */
  fields: readonly Field[]
  vocabularies: Vocabularies
  values: FilterValues
  onChange: (key: string, value: string) => void
  onClear: () => void
  /** Extra options injected into a field, e.g. "Ours only" on actor. */
  extraOptions?: Record<string, readonly { value: string; label: string }[]>
}

/**
 * One filter row above everything it scopes — never a filter per table or
 * inside a card, so every view below re-renders against the same slice.
 */
export default function EntityFilters({
  fields,
  vocabularies,
  values,
  onChange,
  onClear,
  extraOptions,
}: Props) {
  return (
    <div className="filters">
      {fields.map((field) => {
        // A scoped list narrows with its parent, exactly as the form does:
        // choosing a channel should not then offer another channel's releases.
        const scopeValue = field.scopeBy ? values[field.scopeBy] : undefined
        const scoped = field.scopeBy && !scopeValue
        const options = scoped
          ? vocabularyOf(vocabularies, field.listKind!).active
          : optionsFor(vocabularies, field, scopeValue)

        return (
          <label key={field.key} className="filters__field">
            <span className="filters__label">{field.label}</span>
            <select
              className="input input--inline"
              value={values[field.key] ?? ''}
              onChange={(event) => onChange(field.key, event.target.value)}
            >
              <option value="">Any</option>
              {extraOptions?.[field.key]?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value={NOT_SET}>— Not set —</option>
            </select>
          </label>
        )
      })}

      <button className="btn btn--link" onClick={onClear} disabled={activeFilterCount(values) === 0}>
        Clear
      </button>
    </div>
  )
}
