/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPREADSHEET_ID: string | undefined
  readonly VITE_GOOGLE_CLIENT_ID: string | undefined
  /** Optional — deep-links the admin runbook to the right Cloud project. */
  readonly VITE_GCP_PROJECT_ID: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
