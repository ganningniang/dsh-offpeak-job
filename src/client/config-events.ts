/**
 * Same-tab fan-out when provider peak settings are saved so the composer chip
 * can refresh without waiting for its poll interval.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Subscribe to provider off-peak config writes.
 * @param listener - called synchronously after a successful save.
 * @returns disposer.
 */
export function onOffpeakProviderConfigChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Notify composer / wait dock that provider peak settings changed. */
export function emitOffpeakProviderConfigChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // one bad subscriber must not block the rest
    }
  }
}
