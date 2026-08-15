import { useEffect, useState } from 'react'

/**
 * Connectivity, for telling the user why things are failing.
 *
 * Writes need the network — there is no queue-and-sync — so saying so plainly
 * beats a save that fails for reasons the user cannot see.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
