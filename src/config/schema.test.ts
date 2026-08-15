import { describe, expect, it } from 'vitest'
import { ENTITY_LIST, HOUSEKEEPING_COLUMNS, entities, expectedHeaders, fieldOf } from './schema'

/**
 * Structural checks on the schema itself.
 *
 * These are cheap and catch the mistakes that otherwise surface as a blank
 * column, a silently-dropped value, or a dropdown with no options — none of
 * which raise an error at the point they are caused.
 */
describe.each(ENTITY_LIST)('$sheetName schema', (entity) => {
  it('has unique field keys', () => {
    const keys = entity.fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not shadow a housekeeping column', () => {
    // A domain field called `id` would map to the same sheet column and the
    // record would overwrite its own identity on write.
    for (const field of entity.fields) {
      expect(HOUSEKEEPING_COLUMNS as readonly string[]).not.toContain(field.key)
    }
  })

  it('has a titleField that resolves', () => {
    expect(fieldOf(entity, entity.titleField)).toBeDefined()
  })

  it('has listColumns that all resolve', () => {
    // A listColumns entry with no field is silently dropped from the table.
    for (const key of entity.listColumns) {
      expect(fieldOf(entity, key), `${entity.key}.listColumns has no field \`${key}\``).toBeDefined()
    }
  })

  it('gives every reference field a listKind', () => {
    // Without one there are no options to offer and the dropdown is empty.
    for (const field of entity.fields.filter((f) => f.type === 'reference')) {
      expect(field.listKind, `${field.key} is a reference with no listKind`).toBeDefined()
    }
  })

  it('points every scopeBy at a real field of the same entity', () => {
    for (const field of entity.fields.filter((f) => f.scopeBy)) {
      expect(fieldOf(entity, field.scopeBy!), `${field.key}.scopeBy is not a field`).toBeDefined()
    }
  })

  it('points every link at a real entity', () => {
    for (const field of entity.fields.filter((f) => f.type === 'link')) {
      expect(field.refEntity, `${field.key} is a link with no refEntity`).toBeDefined()
      expect(entities[field.refEntity!]).toBeDefined()
    }
  })

  it('produces headers that start with housekeeping and contain no duplicates', () => {
    const headers = expectedHeaders(entity)
    expect(headers.slice(0, HOUSEKEEPING_COLUMNS.length)).toEqual([...HOUSEKEEPING_COLUMNS])
    expect(new Set(headers).size).toBe(headers.length)
  })
})

describe('entities', () => {
  it('gives every entity a distinct tab', () => {
    const tabs = ENTITY_LIST.map((e) => e.sheetName)
    expect(new Set(tabs).size).toBe(tabs.length)
  })

  it('keys each entity by its own key', () => {
    for (const [key, entity] of Object.entries(entities)) {
      expect(entity.key).toBe(key)
    }
  })

  it('does not collide with the tabs the app already owns', () => {
    const reserved = ['Users', 'Audit', 'Lists', 'Meta']
    for (const entity of ENTITY_LIST) {
      expect(reserved).not.toContain(entity.sheetName)
    }
  })
})
