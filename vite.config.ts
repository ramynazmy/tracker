import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // Must match the GitHub repo name, with both slashes. GitHub Pages serves the
  // site at https://<user>.github.io/tracker/, so every asset URL needs this
  // prefix baked in at build time. Get it wrong and you get a white page with
  // 404s on every JS asset. Change to '/' if you move to a custom domain.
  base: '/tracker/',

  server: {
    // Pinned because http://localhost:5173 is registered as an authorised
    // JavaScript origin on the OAuth client. If Vite silently moved to 5174
    // (which it does when 5173 is busy), sign-in would fail with an origin
    // mismatch that looks nothing like a port problem.
    port: 5173,
    strictPort: true,
  },
})
