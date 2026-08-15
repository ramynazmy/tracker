import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useTracker } from '../data/TrackerDataContext'
import LoadError from '../components/LoadError'
import { canWriteRecords, READ_ONLY_MESSAGE } from '../lib/permissions'
import type { ListKind } from '../config/schema'
import {
  createListValue,
  labelFor,
  OWNED_MARKER,
  proposeId,
  updateListValue,
  vocabularyOf,
  type ListItem,
  type Vocabularies,
} from '../sheets/lists'
import { spreadsheetUrl } from '../lib/links'

/**
 * Managing the vocabularies from the app.
 *
 * These rows were always editable — the Lists tab is unprotected below row 1
 * precisely so adding a release stays a data edit rather than an admin task.
 * This screen is that same edit for people who should not have to open the
 * spreadsheet to make it.
 *
 * What it deliberately does NOT offer:
 *
 *   - **Changing an id.** Records store the id, so changing one strands every
 *     feature and action holding the old value, silently — there is no foreign
 *     key to cascade through and nothing would report it. Renaming edits the
 *     label, which is the part anybody actually reads.
 *   - **Deleting a value.** Retiring hides it from every dropdown while the
 *     records already carrying it keep resolving to a label. A deleted row
 *     turns those into unknown-value warnings across the app.
 */

interface KindConfig {
  kind: ListKind
  title: string
  hint: string
  /**
   * How this list uses the `parent` column. `channel` scopes a release to its
   * channel; `owned` is the actor list's reuse of the same column as an
   * is-this-ours marker; undefined means the column is unused here.
   */
  scope?: 'channel' | 'owned'
  /** The word for one of these, used in the add form. */
  noun: string
}

/** The three the team asked for first; the rest are here so nothing is missing. */
const KINDS: KindConfig[] = [
  {
    kind: 'channel',
    title: 'Channels',
    noun: 'channel',
    hint: 'Each feature belongs to one. Renaming is safe — features store the id, not the name.',
  },
  {
    kind: 'release',
    title: 'Releases',
    noun: 'release',
    scope: 'channel',
    hint: 'Scoped to a channel: R6 under two channels is two different releases.',
  },
  {
    kind: 'actor',
    title: 'Done by',
    noun: 'actor',
    scope: 'owned',
    hint:
      'Who performs an action. Anyone not marked as ours is timeline context — their rows show ' +
      'up in the timeline but never in this team’s open or overdue counts.',
  },
  { kind: 'owner', title: 'Owners', noun: 'owner', hint: 'The named person on a feature or action.' },
  {
    kind: 'actionType',
    title: 'Action types',
    noun: 'type',
    hint: 'The kind of architecture work an action is.',
  },
  { kind: 'featureStatus', title: 'Feature statuses', noun: 'status', hint: '' },
  { kind: 'actionStatus', title: 'Action statuses', noun: 'status', hint: '' },
  { kind: 'platform', title: 'Parts / platforms', noun: 'platform', hint: '' },
  { kind: 'complexity', title: 'Complexity', noun: 'value', hint: '' },
  { kind: 'asdRequired', title: 'ASD required', noun: 'value', hint: '' },
  { kind: 'asdStatus', title: 'ASD status', noun: 'value', hint: '' },
]

export default function Lists() {
  const { state } = useAuth()
  const { vocabularies, loading, error, refresh } = useTracker()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (state.status !== 'ready') return null
  const canEdit = canWriteRecords(state.user.role)

  if (error) {
    return (
      <section>
        <LoadError error={error} />
      </section>
    )
  }

  /**
   * Every edit re-reads the whole app afterwards rather than patching state.
   * A vocabulary change can invalidate anything on screen — a retired channel
   * changes which releases are offered, a rename changes labels in three
   * places — and one extra read is cheaper than reasoning about all of that.
   */
  async function run(key: string, write: () => Promise<unknown>) {
    setBusy(key)
    setMessage(null)
    try {
      await write()
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={loading ? 'is-refetching' : undefined}>
      <div className="page-head">
        <div>
          <h1>Lists</h1>
          <p className="muted">
            Channels, releases and the rest. Changes are live for the app as soon as they save.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className="card card--warn">
          <p>{READ_ONLY_MESSAGE} You can see the lists but not change them.</p>
        </div>
      )}

      {message && (
        <div className="card card--warn" role="alert">
          <p>{message}</p>
        </div>
      )}

      <div className="card card--info">
        <p className="muted">
          The app picks these up on its next load. The <strong>dropdowns inside the spreadsheet</strong>{' '}
          do not — they are a snapshot taken when the script last ran. If people also type
          straight into the workbook, run <code>refreshValidation()</code> from{' '}
          <a href={spreadsheetUrl()} target="_blank" rel="noreferrer">
            the spreadsheet’s
          </a>{' '}
          Apps Script editor after adding values.
        </p>
      </div>

      {KINDS.map((config) => (
        <KindSection
          key={config.kind}
          config={config}
          vocabularies={vocabularies}
          canEdit={canEdit}
          busy={busy}
          actorEmail={state.user.email}
          run={run}
        />
      ))}
    </section>
  )
}

function KindSection({
  config,
  vocabularies,
  canEdit,
  busy,
  actorEmail,
  run,
}: {
  config: KindConfig
  vocabularies: Vocabularies
  canEdit: boolean
  busy: string | null
  actorEmail: string
  run: (key: string, write: () => Promise<unknown>) => Promise<void>
}) {
  const items = vocabularyOf(vocabularies, config.kind).all
  const channels = vocabularyOf(vocabularies, 'channel').active

  const [draft, setDraft] = useState('')
  const [draftParent, setDraftParent] = useState('')
  const [draftOurs, setDraftOurs] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  const parentOf = (): string | null => {
    if (config.scope === 'channel') return draftParent || null
    if (config.scope === 'owned') return draftOurs ? OWNED_MARKER : null
    return null
  }

  // Shown live under the input: the id is permanent, so it should not be a
  // surprise that only appears after saving.
  const previewId = proposeId(config.kind, draft, parentOf())
  const canAdd =
    canEdit && draft.trim() !== '' && previewId !== '' && (config.scope !== 'channel' || draftParent !== '')

  async function add() {
    await run(`add-${config.kind}`, async () => {
      await createListValue({ kind: config.kind, label: draft, parent: parentOf() }, actorEmail)
      setDraft('')
      setDraftOurs(false)
    })
  }

  async function rename(item: ListItem) {
    await run(`edit-${item.id}`, async () => {
      await updateListValue(item.kind, item.id, { label: editLabel }, actorEmail)
      setEditing(null)
    })
  }

  return (
    <section className="card">
      <h2 className="panel__title">{config.title}</h2>
      {config.hint && <p className="panel__note muted">{config.hint}</p>}

      {items.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <ul className="vocab">
          {items.map((item) => {
            const rowBusy = busy === `edit-${item.id}` || busy === `active-${item.id}`
            return (
              <li key={item.id} className={item.active ? 'vocab__row' : 'vocab__row vocab__row--off'}>
                {editing === item.id ? (
                  <input
                    className="input input--inline"
                    value={editLabel}
                    autoFocus
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(item)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span className="vocab__label">{item.label}</span>
                )}

                {/* The id, shown and never editable: it is what every record
                    holds, so it is the one thing here that cannot change. */}
                <code className="vocab__id" title="Stored on every record — cannot be changed">
                  {item.id}
                </code>

                <span className="vocab__scope muted">
                  {config.scope === 'channel' && item.parent
                    ? labelFor(vocabularies, 'channel', item.parent)
                    : ''}
                  {config.scope === 'owned' && (
                    <label className="vocab__ours">
                      <input
                        type="checkbox"
                        checked={item.parent === OWNED_MARKER}
                        disabled={!canEdit || rowBusy}
                        onChange={(e) =>
                          void run(`active-${item.id}`, () =>
                            updateListValue(
                              item.kind,
                              item.id,
                              { parent: e.target.checked ? OWNED_MARKER : null },
                              actorEmail,
                            ),
                          )
                        }
                      />
                      ours
                    </label>
                  )}
                </span>

                {/* Always rendered, empty or not: it owns a column, and a cell
                    that disappears shifts the buttons after it. */}
                <span className="vocab__state">
                  {!item.active && <span className="chip chip--unknown">Retired</span>}
                </span>

                <span className="vocab__actions">
                  {canEdit &&
                    (editing === item.id ? (
                      <>
                        <button className="btn btn--inline" disabled={rowBusy} onClick={() => void rename(item)}>
                          Save
                        </button>
                        <button className="btn btn--inline" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn--inline"
                          disabled={rowBusy}
                          onClick={() => {
                            setEditing(item.id)
                            setEditLabel(item.label)
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="btn btn--inline"
                          disabled={rowBusy}
                          onClick={() =>
                            void run(`active-${item.id}`, () =>
                              updateListValue(item.kind, item.id, { active: !item.active }, actorEmail),
                            )
                          }
                        >
                          {item.active ? 'Retire' : 'Restore'}
                        </button>
                      </>
                    ))}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="vocab__add">
          {config.scope === 'channel' && (
            <select
              className="input input--inline"
              value={draftParent}
              onChange={(e) => setDraftParent(e.target.value)}
            >
              <option value="">Channel…</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
          )}

          <input
            className="input input--inline"
            placeholder={`New ${config.noun}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canAdd) void add()
            }}
          />

          {config.scope === 'owned' && (
            <label className="vocab__ours">
              <input
                type="checkbox"
                checked={draftOurs}
                onChange={(e) => setDraftOurs(e.target.checked)}
              />
              we do this work
            </label>
          )}

          <button
            className="btn btn--primary"
            disabled={!canAdd || busy === `add-${config.kind}`}
            onClick={() => void add()}
          >
            Add
          </button>

          {draft.trim() !== '' && (
            <span className="muted vocab__preview">
              {previewId ? (
                <>
                  saved as <code>{previewId}</code>
                </>
              ) : (
                'needs at least one letter or number'
              )}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
