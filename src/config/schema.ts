/**
 * The entity schemas. This is the single source of truth for the app's data
 * shape: each field definition drives the form input that gets rendered, the
 * validation that runs before every write, and the cell formatting in the table.
 *
 * The app tracks two entities, mirroring how the team works: a FEATURE is a
 * piece of work in a channel and a release; an ACTION is something the architect
 * team has to do about a feature. Actions point at their feature by UUID.
 *
 * To add a field:
 *   1. add an entry to the entity's `fields` below
 *   2. add the matching header cell to row 1 of that entity's tab
 * Field order here should match the sheet's domain columns, after the six
 * housekeeping columns — though `indexHeaders` reads positions from row 1, so a
 * hand-reordered sheet still works.
 *
 * To add a CHANNEL, RELEASE, OWNER or STATUS, do not touch this file: those are
 * `reference` fields whose values live in the Lists tab and are read at runtime.
 * See src/sheets/lists.ts.
 */

export const HOUSEKEEPING_COLUMNS = [
  'id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deleted',
] as const

export type FieldType =
  | 'text'
  | 'longtext'
  | 'select'
  | 'number'
  | 'date'
  | 'email'
  /** Value comes from the Lists tab, stored as a stable slug id. */
  | 'reference'
  /** Value is another entity's UUID. */
  | 'link'

/**
 * The vocabularies held in the Lists tab. Adding a *value* to one of these is a
 * sheet edit; adding a new kind is a code change, because a field has to point
 * at it.
 */
export type ListKind =
  | 'channel'
  | 'release'
  | 'platform'
  | 'featureStatus'
  | 'complexity'
  | 'asdRequired'
  | 'asdStatus'
  | 'owner'
  | 'actionStatus'
  /** What kind of architecture work an action is — TOGAF service activities. */
  | 'actionType'
  /** Who performs it. Not every row on the timeline is ours to do. */
  | 'actor'

/**
 * The actor whose work the architecture team owes.
 *
 * Rows with any other actor are timeline context — a delivery milestone, a
 * vendor deliverable — and must NOT count toward a feature's open-action
 * rollup or the overdue figure, or those numbers stop meaning "what we owe".
 *
 * A blank actor counts as ours: every action predates this field, and
 * defaulting them out would silently zero every rollup on the board.
 */
export const ARCHITECTURE_ACTOR = 'architecture'

export type EntityKey = 'feature' | 'action'

export interface Field {
  key: string
  label: string
  type: FieldType
  required?: boolean
  maxLength?: number
  min?: number
  max?: number
  /** `select` only — a literal, compile-time vocabulary. */
  options?: readonly string[]
  /** `reference` only — which Lists vocabulary supplies the options. */
  listKind?: ListKind
  /**
   * `reference` only — the field key whose value narrows this list. Releases
   * are scoped to a channel: picking Alpha must not offer R8.
   */
  scopeBy?: string
  /** `link` only — which entity the stored UUID points at. */
  refEntity?: EntityKey
  /**
   * `date` only — the form also offers "in N days", counted from this field's
   * value (or from today when it is blank). The stored value is a plain date
   * either way; the sheet never sees a duration.
   */
  daysFrom?: string
}

export interface EntitySchema {
  key: EntityKey
  /** Tab name. Also the range prefix — see `rangeFor` in sheets/collection.ts. */
  sheetName: string
  label: string
  labelPlural: string
  /**
   * The field that names the record. Used for audit summaries and for the label
   * shown when another entity links to it. NOT `fields[0]`: on an action that
   * would be `featureId`, which would fill the audit log with bare UUIDs.
   */
  titleField: string
  fields: readonly Field[]
  /** Columns shown in the list view. Others appear only on the detail form. */
  listColumns: readonly string[]
}

const featureFields: readonly Field[] = [
  { key: 'name', label: 'Feature', type: 'text', required: true, maxLength: 300 },
  { key: 'channel', label: 'Channel', type: 'reference', listKind: 'channel', required: true },
  { key: 'release', label: 'Release', type: 'reference', listKind: 'release', scopeBy: 'channel' },
  { key: 'platform', label: 'Part / Platform', type: 'reference', listKind: 'platform' },
  { key: 'status', label: 'Status', type: 'reference', listKind: 'featureStatus', required: true },
  { key: 'complexity', label: 'Complexity', type: 'reference', listKind: 'complexity' },
  { key: 'asdRequired', label: 'ASD Required', type: 'reference', listKind: 'asdRequired' },
  { key: 'asdStatus', label: 'ASD Status', type: 'reference', listKind: 'asdStatus' },
  { key: 'owner', label: 'Owner', type: 'reference', listKind: 'owner' },
  { key: 'notes', label: 'Notes', type: 'longtext', maxLength: 2000 },
]

const actionFields: readonly Field[] = [
  { key: 'featureId', label: 'Feature', type: 'link', refEntity: 'feature', required: true },
  { key: 'name', label: 'Action', type: 'text', required: true, maxLength: 500 },
  { key: 'type', label: 'Type', type: 'reference', listKind: 'actionType' },
  // Not required: a row with no actor is ours, which keeps every pre-existing
  // action counting toward the rollups it already counted toward.
  { key: 'actor', label: 'Done by', type: 'reference', listKind: 'actor' },
  { key: 'owner', label: 'Owner', type: 'reference', listKind: 'owner' },
  { key: 'status', label: 'Status', type: 'reference', listKind: 'actionStatus', required: true },
  { key: 'raisedOn', label: 'Start', type: 'date' },
  { key: 'dueDate', label: 'Due', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'longtext', maxLength: 2000 },
]

export const entities: Record<EntityKey, EntitySchema> = {
  feature: {
    key: 'feature',
    sheetName: 'Features',
    label: 'Feature',
    labelPlural: 'Features',
    titleField: 'name',
    fields: featureFields,
    listColumns: ['name', 'channel', 'release', 'status', 'owner'],
  },
  action: {
    key: 'action',
    sheetName: 'Actions',
    label: 'Action',
    labelPlural: 'Actions',
    titleField: 'name',
    fields: actionFields,
    listColumns: ['name', 'featureId', 'type', 'actor', 'status', 'dueDate'],
  },
}

export const ENTITY_LIST: readonly EntitySchema[] = [entities.feature, entities.action]

/** Full expected header row of an entity's tab, in order. */
export function expectedHeaders(entity: EntitySchema): readonly string[] {
  return [...HOUSEKEEPING_COLUMNS, ...entity.fields.map((f) => f.key)]
}

export function fieldOf(entity: EntitySchema, key: string): Field | undefined {
  return entity.fields.find((f) => f.key === key)
}

/**
 * The two ways an Actions row is entered. Same entity, same tab, different
 * form: an ACTION is work we do, so it carries an owner, a status and a
 * start/due pair, and its actor stays blank (blank = ours). An EVENT is a
 * moment on the timeline done by someone else — a delivery milestone, a vendor
 * drop — so it is just a name, a date, who does it, and notes.
 *
 * A variant is a view over `actionFields`, not a second schema: hidden fields
 * keep whatever value the record already holds, and the sheet row is identical
 * either way.
 */
export type ActionVariant = 'action' | 'event'

const VARIANT_FIELDS: Record<ActionVariant, readonly (readonly [string, Partial<Field>])[]> = {
  action: [
    ['featureId', {}],
    ['name', {}],
    ['type', {}],
    ['owner', {}],
    ['status', {}],
    ['raisedOn', {}],
    // "Due" accepts a count of days as well as a date, counted from Start.
    ['dueDate', { daysFrom: 'raisedOn' }],
    ['notes', {}],
  ],
  event: [
    ['featureId', {}],
    ['name', { label: 'Event' }],
    ['dueDate', { label: 'When', required: true }],
    // Required here, unlike the base field: a blank actor means "ours", which
    // would silently turn the event into our workload in every rollup.
    ['actor', { label: 'Done by / triggered by', required: true }],
    ['notes', {}],
  ],
}

/** The fields the form shows (and validates) for one variant of an action. */
export function actionFormFields(variant: ActionVariant): Field[] {
  return VARIANT_FIELDS[variant].map(([key, overrides]) => ({
    ...fieldOf(entities.action, key)!,
    ...overrides,
  }))
}
