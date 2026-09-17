/**
 * Track unmatched approval/asked vs approval/decided for overview badge.
 * No Host query API exists for pending approval; fold the session log.
 */

export interface ApprovalPendingLogger {
  warn?: (msg: string) => void
}

/**
 * Per-session pending tool-approval ids (Host-side).
 */
export class ApprovalPendingTracker {
  readonly #pending = new Map<string, Set<string>>()

  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one approval is unanswered.
   */
  hasPending(sessionId: string): boolean {
    return (this.#pending.get(sessionId)?.size ?? 0) > 0
  }

  /**
   * @returns session ids that currently have pending approvals.
   */
  pendingSessionIds(): string[] {
    return [...this.#pending.entries()]
      .filter(([, ids]) => ids.size > 0)
      .map(([id]) => id)
  }

  /**
   * Seed / update from a session event fold.
   * @param sessionId - session that owns the event.
   * @param event - session log event.
   */
  onEvent(sessionId: string, event: { type?: string; data?: { id?: string } }): void {
    if (event.type === 'turn/end') {
      this.#pending.delete(sessionId)
      return
    }
    const id = event.data?.id
    if (typeof id !== 'string' || id.length === 0) return
    if (event.type === 'approval/asked') {
      let set = this.#pending.get(sessionId)
      if (set === undefined) {
        set = new Set()
        this.#pending.set(sessionId, set)
      }
      set.add(id)
      return
    }
    if (event.type === 'approval/decided') {
      const set = this.#pending.get(sessionId)
      if (set === undefined) return
      set.delete(id)
      if (set.size === 0) this.#pending.delete(sessionId)
    }
  }

  /**
   * Replace pending ids for a session from a full log fold.
   * @param sessionId - session to seed.
   * @param events - session snapshot events.
   */
  seedFromEvents(sessionId: string, events: Iterable<{ type?: string; data?: { id?: string } }>): void {
    this.#pending.delete(sessionId)
    for (const event of events) this.onEvent(sessionId, event)
  }

  /**
   * Subscribe to Host session events and seed live sessions.
   * @param ctx - Cordis context with optional sessions + on.
   * @returns disposer.
   */
  install(ctx: any, logger?: ApprovalPendingLogger): () => void {
    if (typeof ctx?.on !== 'function') {
      logger?.warn?.('[dsh-offpeak-job] ctx.on unavailable — skipping approval pending tracker')
      return () => {}
    }

    const seedSession = (session: any) => {
      const id = typeof session?.id === 'string' ? session.id : undefined
      if (id === undefined) return
      try {
        const events = typeof session.snapshotEvents === 'function'
          ? session.snapshotEvents()
          : []
        this.seedFromEvents(id, events)
      } catch {
        // Session may be disposing; leave tracker empty for this id.
      }
    }

    try {
      const list = ctx.sessions?.list?.()
      if (Array.isArray(list)) {
        for (const session of list) seedSession(session)
      }
    } catch {
      // sessions service optional at plugin load.
    }

    const offs: Array<() => void> = []
    const onCreated = ctx.on('session/created', (session: any) => {
      seedSession(session)
    }, { global: true })
    if (typeof onCreated === 'function') offs.push(onCreated)

    const onEvent = ctx.on('session/event', (session: any, event: any) => {
      const id = typeof session?.id === 'string' ? session.id : undefined
      if (id === undefined) return
      this.onEvent(id, event)
    }, { global: true })
    if (typeof onEvent === 'function') offs.push(onEvent)

    const onDisposed = ctx.on('session/disposed', (session: any) => {
      const id = typeof session?.id === 'string' ? session.id : undefined
      if (id !== undefined) this.#pending.delete(id)
    }, { global: true })
    if (typeof onDisposed === 'function') offs.push(onDisposed)

    return () => {
      for (const off of offs) off()
      this.#pending.clear()
    }
  }
}
