import { SheetsError } from '../sheets/client'
import { HeaderContractError } from '../sheets/rows'

/**
 * Distinguishes the failures worth acting on. A broken header contract is an
 * instruction, not an apology — it names the column, the tab, and where to add
 * it.
 */
export default function LoadError({ error }: { error: Error }) {
  if (error instanceof HeaderContractError) {
    return (
      <div className="card card--warn">
        <strong>The {error.sheetName} tab does not match the app</strong>
        <p>{error.message}</p>
        <p className="muted">
          If the tab does not exist yet, run <code>setupTracker()</code> from the spreadsheet’s
          Apps Script editor.
        </p>
      </div>
    )
  }

  if (error instanceof SheetsError && error.isRateLimited) {
    return (
      <div className="card card--warn">
        <strong>Too many requests</strong>
        <p className="muted">Google is rate-limiting reads. Wait a moment, then refresh.</p>
      </div>
    )
  }

  if (error instanceof SheetsError && error.isNotFound) {
    return (
      <div className="card card--warn">
        <strong>Spreadsheet not found</strong>
        <p className="muted">Check VITE_SPREADSHEET_ID — this is a configuration error.</p>
      </div>
    )
  }

  return (
    <div className="card card--warn">
      <strong>Could not load data</strong>
      <p>{error.message}</p>
    </div>
  )
}
