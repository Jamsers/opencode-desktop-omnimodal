import { createStore } from "solid-js/store"
import type { Platform } from "@/runtime/platform/platform"

// One global preference, persisted by the desktop process so the server-side read conversion sees
// the same switch. A web build has no such capability and keeps the default.
const [state, setState] = createStore({ convert: true, loaded: false })
let pending: Promise<void> | undefined

export const mediaConversion = {
  enabled: () => state.convert,
  load(platform: Platform) {
    if (state.loaded) return Promise.resolve()

    pending ??= (platform.getMediaPreference?.() ?? Promise.resolve(true))
      .then((convert) => setState({ convert, loaded: true }))
      .catch(() => setState("loaded", true))

    return pending
  },
  async set(platform: Platform, convert: boolean) {
    setState({ convert, loaded: true })

    const write = platform.setMediaPreference?.(convert)
    if (write) await write.catch(() => {})
  },
}
