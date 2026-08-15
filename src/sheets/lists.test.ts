import { describe, expect, it } from 'vitest'
import {
  indexListsSheet,
  isUnknownValue,
  labelFor,
  optionsFor,
  ownedActorIds,
  parseLists,
  proposeId,
  slugify,
  vocabularyOf,
} from './lists'
import type { Field } from '../config/schema'

const HEADERS = ['kind', 'id', 'label', 'parent', 'active', 'order']

const channelField: Field = { key: 'channel', label: 'Channel', type: 'reference', listKind: 'channel' }
const releaseField: Field = {
  key: 'release',
  label: 'Release',
  type: 'reference',
  listKind: 'release',
  scopeBy: 'channel',
}

const rows = [
  HEADERS,
  ['channel', 'alpha', 'Alpha', '', true, 1],
  ['channel', 'beta', 'Beta', '', true, 2],
  ['channel', 'gamma', 'Gamma', '', true, 3],
  ['release', 'alpha-r3', 'R3', 'alpha', true, 3],
  ['release', 'alpha-r6', 'R6', 'alpha', true, 6],
  ['release', 'beta-r6', 'R6', 'beta', true, 6],
  ['release', 'beta-backlog', 'Backlog', 'beta', true, 99],
  ['owner', 'unassigned', 'Unassigned', '', true, 99],
  ['owner', 'departed', 'Someone Who Left', '', false, 50],
]

describe('parseLists', () => {
  it('groups values by kind', () => {
    const v = parseLists(rows)
    expect(v.get('channel')!.active).toHaveLength(3)
    expect(v.get('release')!.active).toHaveLength(4)
  })

  it('reads columns by header name, so the tab can be re-ordered', () => {
    const swapped = [
      ['order', 'active', 'parent', 'label', 'id', 'kind'],
      [1, true, '', 'Alpha', 'alpha', 'channel'],
    ]
    expect(labelFor(parseLists(swapped), 'channel', 'alpha')).toBe('Alpha')
  })

  it('sorts by order, not by sheet position', () => {
    const unordered = [
      HEADERS,
      ['channel', 'c', 'C', '', true, 3],
      ['channel', 'a', 'A', '', true, 1],
      ['channel', 'b', 'B', '', true, 2],
    ]
    expect(parseLists(unordered).get('channel')!.active.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to sheet order when `order` is blank', () => {
    const noOrder = [
      HEADERS,
      ['channel', 'first', 'First', '', true, ''],
      ['channel', 'second', 'Second', '', true, ''],
    ]
    expect(parseLists(noOrder).get('channel')!.active.map((i) => i.id)).toEqual(['first', 'second'])
  })

  it('skips rows with no kind or no id — a stray note below the data', () => {
    const messy = [HEADERS, ['channel', '', 'orphan label', '', true, 1], ['', 'x', 'y', '', true, 2], ['remember to ask Bob']]
    expect(parseLists(messy).size).toBe(0)
  })

  it('collapses a duplicated id so the dropdown cannot show it twice', () => {
    const dupes = [HEADERS, ['channel', 'a', 'First', '', true, 1], ['channel', 'a', 'Second', '', true, 2]]
    const v = parseLists(dupes)
    expect(v.get('channel')!.active).toHaveLength(1)
    expect(labelFor(v, 'channel', 'a')).toBe('First')
  })

  it('falls back to the id when the label cell is blank', () => {
    const noLabel = [HEADERS, ['channel', 'alpha', '', '', true, 1]]
    expect(labelFor(parseLists(noLabel), 'channel', 'alpha')).toBe('alpha')
  })

  it('treats a blank active cell as active', () => {
    // Somebody added a row and did not tick the box. Hiding it would read as
    // the app ignoring their edit.
    const blank = [HEADERS, ['channel', 'a', 'A', '', '', 1]]
    expect(parseLists(blank).get('channel')!.active).toHaveLength(1)
  })

  it('accepts hand-typed TRUE as well as a real checkbox', () => {
    const typed = [HEADERS, ['channel', 'a', 'A', '', 'TRUE', 1], ['channel', 'b', 'B', '', 'no', 2]]
    expect(parseLists(typed).get('channel')!.active.map((i) => i.id)).toEqual(['a'])
  })

  it('returns empty rather than throwing on an empty tab', () => {
    expect(parseLists([]).size).toBe(0)
  })
})

describe('retired values', () => {
  const v = parseLists(rows)

  it('drops a retired value from the choices', () => {
    expect(vocabularyOf(v, 'owner').active.map((i) => i.id)).toEqual(['unassigned'])
  })

  it('still resolves a retired value that records already carry', () => {
    // The whole point of the active/known split: retiring an owner must not
    // make every record they own look broken.
    expect(labelFor(v, 'owner', 'departed')).toBe('Someone Who Left')
    expect(isUnknownValue(v, 'owner', 'departed')).toBe(false)
  })

  it('flags a value that was never listed at all', () => {
    expect(isUnknownValue(v, 'owner', 'typo-name')).toBe(true)
    expect(labelFor(v, 'owner', 'typo-name')).toBe('typo-name')
  })

  it('does not flag a blank', () => {
    expect(isUnknownValue(v, 'owner', '')).toBe(false)
  })
})

describe('optionsFor', () => {
  const v = parseLists(rows)

  it('returns every active value for an unscoped field', () => {
    expect(optionsFor(v, channelField).map((i) => i.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ])
  })

  it('narrows a scoped field to its parent', () => {
    expect(optionsFor(v, releaseField, 'alpha').map((i) => i.id)).toEqual([
      'alpha-r3',
      'alpha-r6',
    ])
  })

  it('keeps same-labelled releases in different channels apart', () => {
    // "R6" exists under two channels and means two different releases.
    const business = optionsFor(v, releaseField, 'alpha')
    const retail = optionsFor(v, releaseField, 'beta')
    expect(business.map((i) => i.label)).toContain('R6')
    expect(retail.map((i) => i.label)).toContain('R6')
    expect(business.map((i) => i.id)).not.toEqual(retail.map((i) => i.id))
  })

  it('offers nothing until the scope is chosen', () => {
    expect(optionsFor(v, releaseField, null)).toEqual([])
    expect(optionsFor(v, releaseField)).toEqual([])
  })

  it('returns empty for a field with no listKind', () => {
    expect(optionsFor(v, { key: 'x', label: 'X', type: 'text' })).toEqual([])
  })

  it('returns empty for a kind that has no rows yet', () => {
    expect(optionsFor(v, { key: 'p', label: 'P', type: 'reference', listKind: 'platform' })).toEqual([])
  })
})

describe('ownedActorIds', () => {
  const actorRows = (marks: Record<string, string>) => [
    HEADERS,
    ...Object.entries(marks).map(([id, parent], i) => [
      'actor',
      id,
      id,
      parent,
      true,
      i + 1,
    ]),
  ]

  it('falls back to the given actor when nothing is marked', () => {
    // The important case, and the current state of the sheet. An empty set
    // would mean "nobody's work is ours" — every rollup would read zero, which
    // looks like good news rather than a misconfiguration.
    const v = parseLists(actorRows({ architecture: '', delivery: '', vendor: '' }))
    expect([...ownedActorIds(v, 'architecture')]).toEqual(['architecture'])
  })

  it('falls back when there is no actor vocabulary at all', () => {
    expect([...ownedActorIds(parseLists([]), 'architecture')]).toEqual(['architecture'])
  })

  it('uses the marked actors once any row carries the marker', () => {
    const v = parseLists(
      actorRows({ 'solution-architecture': 'ours', 'enterprise-architecture': 'ours', delivery: '' }),
    )
    expect(ownedActorIds(v, 'architecture')).toEqual(
      new Set(['solution-architecture', 'enterprise-architecture']),
    )
  })

  it('drops the fallback once the sheet says otherwise', () => {
    // Marking a different actor is how you retire the default, so the fallback
    // must not quietly persist alongside it.
    const v = parseLists(actorRows({ architecture: '', 'solution-architecture': 'ours' }))
    expect(ownedActorIds(v, 'architecture').has('architecture')).toBe(false)
  })

  it('ignores a retired actor even when marked', () => {
    const rows = [
      HEADERS,
      ['actor', 'old-team', 'Old Team', 'ours', false, 1],
      ['actor', 'new-team', 'New Team', 'ours', true, 2],
    ]
    expect([...ownedActorIds(parseLists(rows), 'architecture')]).toEqual(['new-team'])
  })
})

describe('slugify', () => {
  it('makes a readable id from a typed name', () => {
    expect(slugify('Business Banking')).toBe('business-banking')
  })

  it('collapses punctuation and runs of separators', () => {
    expect(slugify('DXP - CRX (Decommission)')).toBe('dxp-crx-decommission')
  })

  it('trims leading and trailing separators', () => {
    expect(slugify('  R2.5  ')).toBe('r2-5')
  })

  it('folds accents rather than dropping the letter', () => {
    // "Reseau" and "Réseau" must not become two different ids.
    expect(slugify('Réseau')).toBe(slugify('Reseau'))
  })

  it('returns empty for a name with nothing to slug', () => {
    expect(slugify('—')).toBe('')
  })
})

describe('proposeId', () => {
  it('prefixes a release with its channel', () => {
    // Release ids are scoped: R6 under two channels is two releases, and an
    // unprefixed id would silently merge them.
    expect(proposeId('release', 'R6', 'business-banking')).toBe('business-banking-r6')
    expect(proposeId('release', 'R6', 'retail-banking')).toBe('retail-banking-r6')
  })

  it('leaves every other kind unprefixed', () => {
    expect(proposeId('channel', 'Retail Banking', null)).toBe('retail-banking')
    // An actor carries `ours` in parent, which is a marker and not a scope.
    expect(proposeId('actor', 'Delivery', 'ours')).toBe('delivery')
  })

  it('is empty when the label has nothing to slug, so the caller can refuse', () => {
    expect(proposeId('channel', '!!', null)).toBe('')
  })
})

describe('indexListsSheet', () => {
  const rows = [
    HEADERS,
    ['channel', 'retail-banking', 'Retail Banking', '', true, 1],
    ['channel', 'business-banking', 'Business Banking', '', true, 2],
    ['release', 'retail-banking-r6', 'R6', 'retail-banking', true, 7],
  ]

  it('resolves a row number for each value', () => {
    const index = indexListsSheet(rows)
    // Row 1 is the header, so the first value is row 2.
    expect(index.rowNumberOf.get('channel\u0000retail-banking')).toBe(2)
    expect(index.rowNumberOf.get('release\u0000retail-banking-r6')).toBe(4)
  })

  it('keeps counting rows past a stray note, so later writes stay on target', () => {
    const withNote = [HEADERS, ['channel', 'retail-banking', 'Retail', '', true, 1], ['not a value'], ['channel', 'x', 'X', '', true, 2]]
    expect(indexListsSheet(withNote).rowNumberOf.get('channel\u0000x')).toBe(4)
  })

  it('reads column positions from the header rather than assuming order', () => {
    const shuffled = [
      ['label', 'kind', 'id'],
      ['Retail Banking', 'channel', 'retail-banking'],
    ]
    const index = indexListsSheet(shuffled)
    expect(index.position.get('id')).toBe(2)
    expect(index.rowNumberOf.get('channel\u0000retail-banking')).toBe(2)
  })

  it('tracks the highest order per kind, so a new value lands last', () => {
    const index = indexListsSheet(rows)
    expect(index.maxOrder.get('channel')).toBe(2)
    expect(index.maxOrder.get('release')).toBe(7)
  })

  it('survives an empty sheet', () => {
    expect(indexListsSheet([]).rowNumberOf.size).toBe(0)
  })

  it('keeps the first of two duplicate ids, matching parseLists', () => {
    const dupes = [HEADERS, ['channel', 'a', 'First', '', true, 1], ['channel', 'a', 'Second', '', true, 2]]
    expect(indexListsSheet(dupes).rowNumberOf.get('channel\u0000a')).toBe(2)
  })
})

describe('parseLists — all', () => {
  it('keeps retired values out of active but present in all', () => {
    const rows = [
      HEADERS,
      ['channel', 'live', 'Live', '', true, 1],
      ['channel', 'gone', 'Gone', '', false, 2],
    ]
    const v = vocabularyOf(parseLists(rows), 'channel')
    expect(v.active.map((i) => i.id)).toEqual(['live'])
    expect(v.all.map((i) => i.id)).toEqual(['live', 'gone'])
  })
})
