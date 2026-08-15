/**
 * One-time Sheet setup for Tracker.
 *
 * HOW TO RUN
 *   1. Open the spreadsheet
 *   2. Extensions → Apps Script
 *   3. Delete whatever is in the editor, paste this file in, Save
 *   4. Select `setupTracker` in the function dropdown → Run
 *   5. Authorise when prompted (it is your own script acting on your own sheet)
 *
 * Safe to re-run: it creates what is missing and rewrites the header rows, but
 * never deletes record data and never overwrites existing seed rows.
 *
 * ORDER OF OPERATIONS for the workbook migration:
 *   1. setupTracker()        — creates Features, Actions, Lists
 *   2. paste lists.tsv into Lists!A2, then features.tsv and actions.tsv
 *   3. refreshValidation()   — builds the dropdowns from whatever Lists holds
 *   4. protectRanges()
 *
 * Keep the header arrays in sync with src/config/schema.ts — row 1 of each
 * entity tab is the contract between the Sheet and the app.
 */

var ADMIN_EMAIL = 'ramy.nazmy@gmail.com'
var ADMIN_NAME = 'Ramy'

// housekeeping (see plan.md §4) + domain fields, a mirror of schema.ts.
var HOUSEKEEPING = ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deleted']

var FEATURES_HEADERS = HOUSEKEEPING.concat([
  'name',
  'channel',
  'release',
  'platform',
  'status',
  'complexity',
  'asdRequired',
  'asdStatus',
  'owner',
  'notes',
])

var ACTIONS_HEADERS = HOUSEKEEPING.concat([
  'featureId',
  'name',
  'type',
  'actor',
  'owner',
  'status',
  'raisedOn',
  'dueDate',
  'notes',
])

var LISTS_HEADERS = ['kind', 'id', 'label', 'parent', 'active', 'order']
var USERS_HEADERS = ['email', 'role', 'displayName', 'active', 'notes']
var AUDIT_HEADERS = ['timestamp', 'actorEmail', 'action', 'recordId', 'summary']
var META_HEADERS = ['key', 'value']

/**
 * Which Lists `kind` supplies each column's dropdown, per tab. This is the
 * sheet-side mirror of the `listKind` on each reference field in schema.ts.
 */
var VALIDATED_COLUMNS = {
  Features: {
    channel: 'channel',
    release: 'release',
    platform: 'platform',
    status: 'featureStatus',
    complexity: 'complexity',
    asdRequired: 'asdRequired',
    asdStatus: 'asdStatus',
    owner: 'owner',
  },
  Actions: {
    type: 'actionType',
    actor: 'actor',
    owner: 'owner',
    status: 'actionStatus',
  },
}

/** Columns holding a date, per tab. */
var DATE_COLUMNS = { Features: [], Actions: ['raisedOn', 'dueDate'] }

function setupTracker() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()

  setupLists(sheetNamed(ss, 'Lists'))
  setupEntity(sheetNamed(ss, 'Features'), FEATURES_HEADERS, 'Features')
  setupEntity(sheetNamed(ss, 'Actions'), ACTIONS_HEADERS, 'Actions')
  setupUsers(sheetNamed(ss, 'Users'))
  setupAudit(sheetNamed(ss, 'Audit'))
  setupMeta(sheetNamed(ss, 'Meta'))

  removeDefaultSheet(ss)

  // The old Records tab is deliberately left alone rather than deleted. It is
  // no longer read by anything; delete it by hand once the team is satisfied
  // the migration is good.
  SpreadsheetApp.getUi().alert(
    'Tracker setup complete.\n\n' +
      'Next:\n' +
      '  1. Paste lists.tsv into Lists!A2\n' +
      '  2. Paste features.tsv into Features!A2 and actions.tsv into Actions!A2\n' +
      '  3. Run refreshValidation()\n' +
      '  4. Run protectRanges()\n\n' +
      'The old Records tab was left in place. Delete it by hand when ready.'
  )
}

function sheetNamed(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name)
}

function writeHeaders(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
  sheet.setFrozenRows(1)
}

/**
 * 1-based column index of a header, or 0 when absent.
 *
 * Every getRange below goes through this rather than through a hard-coded
 * letter. The app reads column positions from row 1 and tolerates a reordered
 * sheet; addressing by letter here would silently apply a dropdown or a date
 * format to the wrong column the moment anyone moved one.
 */
function columnOf(sheet, headerName) {
  var width = sheet.getLastColumn()
  if (width < 1) return 0
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0]
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === headerName) return i + 1
  }
  return 0
}

/** `Sheet!C2:C` for a header name, or null when the column is missing. */
function bodyRange(sheet, headerName) {
  var column = columnOf(sheet, headerName)
  if (!column) return null
  var rows = Math.max(sheet.getMaxRows() - 1, 1)
  return sheet.getRange(2, column, rows, 1)
}

function setupEntity(sheet, headers, tabName) {
  writeHeaders(sheet, headers)

  // Soft-delete flag.
  var deleted = bodyRange(sheet, 'deleted')
  if (deleted) deleted.insertCheckboxes()

  // Real date cells, so Sheets' own sorting, filters and date picker keep
  // working when the tab is edited by hand. The app converts Google's date
  // serial numbers to ISO on read.
  var dates = DATE_COLUMNS[tabName] || []
  for (var i = 0; i < dates.length; i++) {
    var range = bodyRange(sheet, dates[i])
    if (range) range.setNumberFormat('yyyy-mm-dd')
  }
}

function setupLists(sheet) {
  writeHeaders(sheet, LISTS_HEADERS)
  var active = bodyRange(sheet, 'active')
  if (active) active.insertCheckboxes()
  // No seed rows: lists.tsv is generated from the real data so that nothing in
  // the migrated records can reference a vocabulary value that is missing here.
}

function setupUsers(sheet) {
  writeHeaders(sheet, USERS_HEADERS)

  var role = bodyRange(sheet, 'role')
  if (role) {
    role.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(['admin', 'editor', 'viewer'], true)
        .setAllowInvalid(false)
        .build()
    )
  }
  var active = bodyRange(sheet, 'active')
  if (active) active.insertCheckboxes()

  // Seed the first admin, but never clobber an existing user list.
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 1, 5).setValues([[ADMIN_EMAIL, 'admin', ADMIN_NAME, true, '']])
  }
}

function setupAudit(sheet) {
  writeHeaders(sheet, AUDIT_HEADERS)
}

function setupMeta(sheet) {
  writeHeaders(sheet, META_HEADERS)
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 1, 2).setValues([['schemaVersion', 2]])
  } else {
    var keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][0] === 'schemaVersion') sheet.getRange(i + 2, 2).setValue(2)
    }
  }
}

/**
 * Rebuild the in-sheet dropdowns from whatever the Lists tab currently holds.
 *
 * RUN THIS AFTER EDITING LISTS. `requireValueInList` snapshots values at the
 * moment it runs, so adding "R15" to Lists shows up in the APP immediately (it
 * reads the tab at load) but leaves the in-sheet dropdown stale until this
 * runs. That split is deliberate: the app is the source of truth at runtime,
 * and the sheet dropdown is a convenience for hand-editing.
 *
 * Two honest limits:
 *   - The dropdowns store the LABEL a human reads, but records store the `id`.
 *     So these lists offer ids, which look like slugs. Ugly but correct: a
 *     dropdown offering labels would write values the app cannot resolve.
 *   - Releases are scoped to a channel in the app. A sheet dropdown cannot
 *     express that dependency, so it offers every release regardless.
 */
function refreshValidation() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var lists = ss.getSheetByName('Lists')
  if (!lists) {
    SpreadsheetApp.getUi().alert('No Lists tab. Run setupTracker() first.')
    return
  }

  var byKind = readListsByKind(lists)
  var applied = 0

  for (var tabName in VALIDATED_COLUMNS) {
    var sheet = ss.getSheetByName(tabName)
    if (!sheet) continue

    var columns = VALIDATED_COLUMNS[tabName]
    for (var header in columns) {
      var values = byKind[columns[header]] || []
      var range = bodyRange(sheet, header)
      if (!range) continue

      if (values.length === 0) {
        range.clearDataValidations()
        continue
      }

      range.setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(values, true)
          // A warning triangle, not a rejection. Matches the app, which warns
          // on an unrecognised reference rather than blocking the save — and
          // a hard rejection would refuse the migration paste outright if one
          // value drifted.
          .setAllowInvalid(true)
          .build()
      )
      applied++
    }
  }

  SpreadsheetApp.getUi().alert('Refreshed ' + applied + ' dropdown column(s) from the Lists tab.')
}

/** { kind: [id, id, ...] } from the Lists tab, active rows only. */
function readListsByKind(lists) {
  var byKind = {}
  if (lists.getLastRow() < 2) return byKind

  var kindCol = columnOf(lists, 'kind')
  var idCol = columnOf(lists, 'id')
  var activeCol = columnOf(lists, 'active')
  if (!kindCol || !idCol) return byKind

  var rows = lists.getRange(2, 1, lists.getLastRow() - 1, lists.getLastColumn()).getValues()
  for (var i = 0; i < rows.length; i++) {
    var kind = String(rows[i][kindCol - 1]).trim()
    var id = String(rows[i][idCol - 1]).trim()
    if (!kind || !id) continue

    // A blank active cell counts as active, matching parseLists in the app.
    var active = activeCol ? rows[i][activeCol - 1] : true
    if (active === false || String(active).toLowerCase() === 'false') continue

    if (!byKind[kind]) byKind[kind] = []
    if (byKind[kind].indexOf(id) === -1) byKind[kind].push(id)
  }
  return byKind
}

/**
 * PHASE 5 — run this separately, once the app works.
 *
 * Locks the ranges that must not be editable by non-admins. This is only half
 * the enforcement: the other half is Drive sharing, which cannot be set from
 * here. A `viewer` MUST be shared as Drive Viewer, or their role is decorative.
 *
 * ADMIN_EMAILS are the only accounts left able to edit the protected ranges.
 * The spreadsheet owner always retains access regardless.
 *
 * Safe to re-run: existing protections created by this script are replaced.
 */
var ADMIN_EMAILS = ['ramy.nazmy@gmail.com']

var PROTECTION_TAG = 'tracker-managed'

function protectRanges() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()

  clearManagedProtections(ss)

  // The Users tab: without this, an editor sets their own role to admin.
  protectSheet(ss.getSheetByName('Users'), 'Users tab — admins only')

  // The Audit tab: without this, an editor edits away their own trail.
  protectSheet(ss.getSheetByName('Audit'), 'Audit tab — admins only')

  // Header rows are the contract between sheet and app. Protecting only row 1
  // is deliberate — the app writes whole rows from row 2 down, and protecting
  // any cell inside that range would make Google reject an editor's save.
  protectHeaderRow(ss, 'Features')
  protectHeaderRow(ss, 'Actions')

  // Lists: ROW 1 ONLY, not the whole tab.
  //
  // Protecting the sheet would put "add R15" back behind an admin, which is
  // exactly the friction that moving the vocabularies out of the code was
  // meant to remove. Editors add and retire values; nobody renames a header.
  //
  // If the team later decides vocabularies should be admin-controlled, swap
  // this line for protectSheet(ss.getSheetByName('Lists'), ...). That is a
  // policy choice worth making deliberately.
  protectHeaderRow(ss, 'Lists')

  SpreadsheetApp.getUi().alert(
    'Protected: Users, Audit, and row 1 of Features, Actions and Lists.\n\n' +
      'Lists rows stay editable on purpose — adding a channel or a release is ' +
      'a data edit, not a deploy.\n\n' +
      'Still to do by hand: Share the spreadsheet as Editor for admins and ' +
      'editors, and as VIEWER for viewers. That is the part Google enforces.'
  )
}

function protectHeaderRow(ss, tabName) {
  var sheet = ss.getSheetByName(tabName)
  if (!sheet) return
  protectRange(
    sheet.getRange('1:1'),
    tabName + ' header row — renaming a column breaks the app for everyone'
  )
}

function clearManagedProtections(ss) {
  var kinds = [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE]
  for (var k = 0; k < kinds.length; k++) {
    var existing = ss.getProtections(kinds[k])
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getDescription().indexOf(PROTECTION_TAG) !== -1) {
        existing[i].remove()
      }
    }
  }
}

function applyEditors(protection) {
  // removeEditors first: by default every collaborator is an editor of a new
  // protection, which would make it decorative.
  protection.removeEditors(protection.getEditors())
  protection.addEditors(ADMIN_EMAILS)

  // Domain-wide edit access would bypass the whole thing.
  if (protection.canDomainEdit && protection.canDomainEdit()) {
    protection.setDomainEdit(false)
  }
}

function protectSheet(sheet, description) {
  if (!sheet) return
  var protection = sheet.protect().setDescription(description + ' [' + PROTECTION_TAG + ']')
  applyEditors(protection)
}

function protectRange(range, description) {
  var protection = range.protect().setDescription(description + ' [' + PROTECTION_TAG + ']')
  applyEditors(protection)
}

/** Drop the untouched default "Sheet1" once our tabs exist. */
function removeDefaultSheet(ss) {
  var def = ss.getSheetByName('Sheet1')
  if (!def) return
  var isEmpty = def.getLastRow() === 0 && def.getLastColumn() === 0
  if (isEmpty && ss.getSheets().length > 1) ss.deleteSheet(def)
}
