import { sheetsFetch } from './client'
import { sanitizeText } from './rows'

export const AUDIT_RANGE = 'Audit!A:E'

export type AuditAction = 'create' | 'update' | 'delete'

/**
 * Append one audit entry.
 *
 * Best-effort by design: a failure here logs a warning and is swallowed. Losing
 * a log line must never cost the user their save — and the Audit tab is
 * protected against editors, so a legitimate write can fail here for reasons
 * that have nothing to do with the record itself.
 */
export async function appendAudit(
  action: AuditAction,
  recordId: string,
  actorEmail: string,
  summary: string,
): Promise<void> {
  try {
    await sheetsFetch(
      `/values/${encodeURIComponent(AUDIT_RANGE)}:append` +
        '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      {
        method: 'POST',
        body: JSON.stringify({
          values: [[new Date().toISOString(), actorEmail, action, recordId, sanitizeText(summary)]],
        }),
      },
    )
  } catch (error) {
    console.warn('[tracker] audit append failed (not blocking the write):', error)
  }
}
