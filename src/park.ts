/**
 * Park followup/steer outside 谷时 without waking the agent (session stays idle).
 * Soft parks in {@link WaitStateStore} are the durable source of truth (including
 * idle user parks). Idle parks also `send(..., false)` into the live inbox so
 * QueueDock shows rows; the inbox id is stored on the soft park and re-mirrored
 * after Host restart when the process-local inbox is empty. Busy parks stay
 * soft-only until the driver is idle, then release.
 *
 * When the provider `windowEndPolicy` is `pause`, a running 谷时会话 turn is
 * cancelled at the idle-window boundary and a soft-park resume follow-up is
 * queued for the next allowed window (Plan A: no per-origin exemptions).
 * Sends while a resume is held use inbox mirror when the session is idle (host
 * queue control retires transcript echoes); busy sends still soft-park so
 * release can keep resume-then-user order. tool-jobs completion notices always
 * soft-park (never inbox) so QueueDock stays user-only; release order is
 * resume → user → inbox (legacy id-only) → notice. Mirrored inbox rows are
 * removed without a second followup — the soft park delivers once.
 */

import type { SessionConfigStore } from './store.ts'
import type { ProviderScheduleStore } from './provider-store.ts'
import type { WaitStateStore } from './wait-state.ts'
import { nextAllowedInstant, nextDeferInstant, shouldDefer } from './offpeak.ts'
import { resolveSessionProvider } from './resolve-provider.ts'
import { createResumeUserMessage } from './resume-message.ts'
import { isJobCompletionNotice } from './job-notice.ts'

export interface ParkLogger {
  info?: (msg: string) => void
  warn?: (msg: string) => void
}

const WRAPPED = Symbol.for('dsh-offpeak-job.park-wrapped')
const RELEASING = Symbol.for('dsh-offpeak-job.park-releasing')
const INBOX_WRAPPED = Symbol.for('dsh-offpeak-job.inbox-wrapped')

const WINDOW_END_CANCEL = { kind: 'hook' as const, reason: 'offpeak-window-end' }

function sessionIdOf(agent: any): string | undefined {
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function retirePrompt(ctx: any, agent: any, message: unknown): void {
  const source = (message as { source?: { kind?: string; rpcId?: unknown } } | null)?.source
  if (source?.kind !== 'user' || typeof source.rpcId !== 'string') return
  try {
    ctx?.fileUploads?.retirePrompt?.(agent, source.rpcId)
  } catch {
    // optional host service / already retired
  }
}

function messageIdOf(message: unknown): string | undefined {
  const id = (message as { id?: unknown } | null)?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Install followup/steer wrappers on live and future agents.
 * @returns disposer plus release/discard helpers for the HTTP API.
 */
export function installOffpeakPark(
  ctx: any,
  sessions: SessionConfigStore,
  providers: ProviderScheduleStore,
  waits: WaitStateStore,
  logger?: ParkLogger,
): {
  dispose: () => void
  /**
   * @param options.manual - when true (WaitDock / overview Start now), the running
   *   turn from this flush is exempt from window-end pause until the agent is idle.
   */
  release: (sessionId: string, options?: { manual?: boolean }) => number
  discard: (sessionId: string) => number
  discardResume: (sessionId: string) => number
  keepResumeConflict: (sessionId: string) => void
  releaseForProvider: (providerId: string) => number
  reevaluateForProvider: (providerId: string) => number
  countWaitingForProvider: (providerId: string) => number
} {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Timers that fire at the next idle→defer boundary for pause policy. */
  const windowEndTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Sessions whose cancel was issued by this plugin for window-end pause. */
  const resumeAborting = new Set<string>()
  /**
   * Sessions flushed via manual Start now (`POST .../release`); skip window-end
   * pause for the running turn until the agent returns idle.
   */
  const manualPauseBypass = new Set<string>()
  /** Inbox-held parks (idle `send` without wake); keyed by session → message id. */
  const inboxParks = new Map<string, Set<string>>()
  const originals = new WeakMap<object, {
    followup: (message: unknown) => void
    steer: (message: unknown) => void
    send: (message: unknown, target: 'next-turn' | 'next-step', wakeup: boolean) => void
  }>()

  const shouldPark = (agent: any): boolean => {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return false
    if (agent[RELEASING] === true) return false
    const config = sessions.get(sessionId)
    if (!config.enabled) return false
    const providerId = resolveSessionProvider(agent, ctx)
    providers.reload()
    if (providers.get(providerId).chipVisible === false) return false
    const policy = providers.policy(providerId)
    return shouldDefer(new Date(), policy)
  }

  const clearTimer = (sessionId: string) => {
    const timer = timers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
  }

  const clearWindowEndTimer = (sessionId: string) => {
    const timer = windowEndTimers.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      windowEndTimers.delete(sessionId)
    }
  }

  const pausePolicyActive = (sessionId: string, agent: any): boolean => {
    if (!sessions.get(sessionId).enabled) return false
    const providerId = resolveSessionProvider(agent, ctx)
    providers.reload()
    const config = providers.get(providerId)
    if (config.chipVisible === false) return false
    if (config.scheduleKind === 'none') return false
    return config.windowEndPolicy === 'pause'
  }

  const armWindowEndWatch = (sessionId: string, agent: any) => {
    clearWindowEndTimer(sessionId)
    if (agent?.status !== 'running') return
    if (!pausePolicyActive(sessionId, agent)) return
    const providerId = resolveSessionProvider(agent, ctx)
    const policy = providers.policy(providerId)
    const now = new Date()
    const until = nextDeferInstant(now, policy)
    if (until === null) return

    const fire = () => {
      windowEndTimers.delete(sessionId)
      const live = ctx.agents?.get?.(sessionId)
      if (live === undefined) return
      if (!pausePolicyActive(sessionId, live)) return
      if (live.status !== 'running') return
      if (manualPauseBypass.has(sessionId)) return
      const livePolicy = providers.policy(resolveSessionProvider(live, ctx))
      // Only cancel once the clock is outside idle; otherwise re-arm.
      if (!shouldDefer(new Date(), livePolicy)) {
        armWindowEndWatch(sessionId, live)
        return
      }
      logger?.info?.(
        `[dsh-offpeak-job] session ${sessionId}: pausing running turn at idle-window end`,
      )
      resumeAborting.add(sessionId)
      try {
        live.cancel(WINDOW_END_CANCEL, { keepInbox: true })
      } catch (error) {
        resumeAborting.delete(sessionId)
        logger?.warn?.(
          `[dsh-offpeak-job] session ${sessionId}: window-end cancel failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    if (shouldDefer(now, policy) || until.getTime() <= Date.now()) {
      fire()
      return
    }

    const delay = Math.min(Math.max(0, until.getTime() - Date.now()) + 25, 60_000)
    windowEndTimers.set(sessionId, setTimeout(() => {
      const live = ctx.agents?.get?.(sessionId)
      if (live === undefined) {
        windowEndTimers.delete(sessionId)
        return
      }
      if (!pausePolicyActive(sessionId, live) || live.status !== 'running') {
        windowEndTimers.delete(sessionId)
        return
      }
      const livePolicy = providers.policy(resolveSessionProvider(live, ctx))
      const next = nextDeferInstant(new Date(), livePolicy)
      if (next !== null && next.getTime() > Date.now() + 500) {
        armWindowEndWatch(sessionId, live)
        return
      }
      fire()
    }, delay))
  }

  const parkResumeAfterCancel = (sessionId: string, agent: any) => {
    resumeAborting.delete(sessionId)
    clearWindowEndTimer(sessionId)
    if (!sessions.get(sessionId).enabled) return
    if (waits.hasResume(sessionId)) {
      scheduleRelease(sessionId, agent)
      return
    }
    const providerId = resolveSessionProvider(agent, ctx)
    const until = nextAllowedInstant(new Date(), providers.policy(providerId))
    waits.enqueue(sessionId, createResumeUserMessage(), until, providerId, 'resume')
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId}: parked resume until ${until.toISOString()}`,
    )
    scheduleRelease(sessionId, agent)
  }

  const syncInboxIds = (sessionId: string) => {
    const set = inboxParks.get(sessionId)
    waits.setInboxMessageIds(sessionId, set === undefined ? [] : [...set])
  }

  const noteInboxPark = (sessionId: string, message: unknown) => {
    const id = messageIdOf(message)
    if (id === undefined) return
    const set = inboxParks.get(sessionId) ?? new Set<string>()
    set.add(id)
    inboxParks.set(sessionId, set)
    syncInboxIds(sessionId)
  }

  const takeInboxParks = (sessionId: string): string[] => {
    const set = inboxParks.get(sessionId)
    inboxParks.delete(sessionId)
    const ids = set === undefined ? [] : [...set]
    // Wait marker may already be cleared by takeAll; empty sync is a no-op then.
    syncInboxIds(sessionId)
    return ids
  }

  const clearWaitIfIdle = (sessionId: string) => {
    if (waits.hasParked(sessionId)) return
    if ((inboxParks.get(sessionId)?.size ?? 0) > 0) return
    if (waits.inboxMessageIds(sessionId).length > 0) return
    clearTimer(sessionId)
    waits.clear(sessionId)
  }

  const forgetInboxPark = (sessionId: string, messageId: string) => {
    waits.takeByInboxMessageId(sessionId, messageId)
    const set = inboxParks.get(sessionId)
    if (set === undefined || !set.delete(messageId)) {
      syncInboxIds(sessionId)
      clearWaitIfIdle(sessionId)
      return
    }
    if (set.size === 0) inboxParks.delete(sessionId)
    syncInboxIds(sessionId)
    clearWaitIfIdle(sessionId)
  }

  const liveInboxIds = (agent: any): Set<string> => {
    const live = new Set<string>()
    for (const message of agent?.inbox?.nextTurn ?? []) {
      const id = messageIdOf(message)
      if (id !== undefined) live.add(id)
    }
    return live
  }

  /**
   * Re-attach durable soft parks into the live inbox after Host restart.
   * Soft parks with {@link ParkedMessage.inboxMessageId} are re-sent when missing;
   * legacy id-only waits (no payload) are dropped when the inbox is empty.
   */
  const restoreInboxParks = (sessionId: string, agent: any) => {
    const pair = originals.get(agent)
    const live = liveInboxIds(agent)
    const set = inboxParks.get(sessionId) ?? new Set<string>()

    for (const park of waits.list(sessionId)) {
      if (park.inboxMessageId === undefined) continue
      if (live.has(park.inboxMessageId)) {
        set.add(park.inboxMessageId)
        continue
      }
      if (pair === undefined || typeof pair.send !== 'function') {
        // Keep soft park; QueueDock remirror waits until send is wrapped.
        continue
      }
      const before = liveInboxIds(agent)
      pair.send(park.message, 'next-turn', false)
      const after = liveInboxIds(agent)
      let newId = messageIdOf(park.message)
      if (newId === undefined || !after.has(newId)) {
        for (const id of after) {
          if (!before.has(id)) {
            newId = id
            break
          }
        }
      }
      if (newId !== undefined) {
        waits.bindInboxMessageId(sessionId, park.id, newId)
        set.add(newId)
        live.add(newId)
        logger?.info?.(
          `[dsh-offpeak-job] session ${sessionId}: re-mirrored park ${park.id} as inbox ${newId}`,
        )
      }
    }

    // Legacy id-only rows: keep only ids still present in the live inbox.
    for (const id of waits.inboxMessageIds(sessionId)) {
      if (set.has(id)) continue
      if (live.has(id)) set.add(id)
    }

    if (set.size === 0) inboxParks.delete(sessionId)
    else inboxParks.set(sessionId, set)
    syncInboxIds(sessionId)
    clearWaitIfIdle(sessionId)
  }

  const reconcileInboxParks = (sessionId: string, agent: any) => {
    // Prefer remirror for durable park payloads; only prune legacy id-only ghosts.
    const live = liveInboxIds(agent)
    let set = inboxParks.get(sessionId)
    if (set === undefined && waits.inboxMessageIds(sessionId).length > 0) {
      set = new Set(waits.inboxMessageIds(sessionId))
      inboxParks.set(sessionId, set)
    }
    if (set === undefined) {
      clearWaitIfIdle(sessionId)
      return
    }
    const mirrored = new Set(waits.mirroredInboxIds(sessionId))
    for (const id of [...set]) {
      if (live.has(id)) continue
      if (mirrored.has(id)) {
        // Durable mirror missing from inbox — restore path remirrors; do not drop park.
        continue
      }
      set.delete(id)
    }
    if (set.size === 0) inboxParks.delete(sessionId)
    syncInboxIds(sessionId)
    clearWaitIfIdle(sessionId)
  }

  const deliver = (agent: any, message: unknown) => {
    const pair = originals.get(agent)
    if (pair === undefined) {
      agent.followup(message)
      return
    }
    pair.followup(message)
  }

  const release = (sessionId: string, options?: { manual?: boolean }): number => {
    clearTimer(sessionId)
    const agents = ctx.agents
    const agent = agents?.get?.(sessionId)
    if (agent === undefined) {
      const soft = waits.list(sessionId).length
      const inbox = inboxParks.get(sessionId)?.size
        ?? waits.inboxMessageIds(sessionId).length
      if (soft + inbox > 0) {
        logger?.warn?.(
          `[dsh-offpeak-job] session ${sessionId}: release deferred — agent gone, ${
            soft + inbox
          } park(s) retained on disk`,
        )
      }
      return 0
    }
    const manual = options?.manual === true
    if (manual) manualPauseBypass.add(sessionId)
    waits.setSendConflict(sessionId, false)
    const soft = waits.takeAll(sessionId)
    const mirroredInboxIds = new Set(
      soft
        .map(row => row.inboxMessageId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )
    const inboxIds = new Set(takeInboxParks(sessionId))

    const pair = originals.get(agent)
    // Drain inbox parks BEFORE any followup, so resume is never appended behind
    // a user row that was still sitting in next-turn (FIFO would run user first).
    // Mirrored rows are removed only — soft park delivers them once.
    const fromInbox: unknown[] = []
    if (agent.inbox?.nextTurn) {
      for (const message of [...agent.inbox.nextTurn]) {
        const id = messageIdOf(message)
        if (id === undefined) continue
        if (mirroredInboxIds.has(id)) {
          try {
            agent.inbox.remove(id)
          } catch {
            // already claimed/removed
          }
          continue
        }
        if (inboxIds.size > 0 && !inboxIds.has(id)) continue
        // When we tracked parks, only drain those ids; if the set is empty but
        // soft parks exist, do not touch unrelated inbox rows.
        if (inboxIds.size === 0) continue
        try {
          agent.inbox.remove(id)
        } catch {
          // already claimed/removed
        }
        fromInbox.push(message)
      }
    }

    const orderedMessages: unknown[] = [
      ...soft.filter(row => row.kind === 'resume').map(row => row.message),
      ...soft.filter(row => row.kind === 'user').map(row => row.message),
      ...fromInbox,
      ...soft.filter(row => row.kind === 'notice').map(row => row.message),
    ]

    agent[RELEASING] = true
    let count = 0
    try {
      for (const message of orderedMessages) {
        logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: releasing parked message`)
        deliver(agent, message)
        count += 1
      }
    } finally {
      agent[RELEASING] = false
    }
    if (manual && count === 0) manualPauseBypass.delete(sessionId)
    void pair
    return count
  }

  const discard = (sessionId: string): number => {
    clearTimer(sessionId)
    clearWindowEndTimer(sessionId)
    resumeAborting.delete(sessionId)
    manualPauseBypass.delete(sessionId)
    waits.setSendConflict(sessionId, false)
    const soft = waits.takeAll(sessionId)
    const inboxIds = takeInboxParks(sessionId)
    const agents = ctx.agents
    const agent = agents?.get?.(sessionId)
    let count = 0
    if (agent !== undefined) {
      for (const id of inboxIds) {
        const message = agent.inbox?.nextTurn?.find?.((row: unknown) => messageIdOf(row) === id)
        try {
          agent.inbox?.remove?.(id)
          count += 1
        } catch {
          // already gone
        }
        if (message !== undefined) retirePrompt(ctx, agent, message)
      }
    } else {
      count += inboxIds.length
    }
    for (const item of soft) {
      if (agent !== undefined) retirePrompt(ctx, agent, item.message)
      count += 1
    }
    if (count > 0) {
      logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: discarded ${count} parked message(s)`)
    }
    return count
  }

  const discardResume = (sessionId: string): number => {
    const removed = waits.discardResume(sessionId)
    const agent = ctx.agents?.get?.(sessionId)
    if (agent !== undefined) {
      clearWaitIfIdle(sessionId)
      scheduleRelease(sessionId, agent)
    } else if (
      !waits.hasParked(sessionId)
      && (inboxParks.get(sessionId)?.size ?? 0) === 0
      && waits.inboxMessageIds(sessionId).length === 0
    ) {
      waits.clear(sessionId)
    }
    if (removed > 0) {
      logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: discarded ${removed} resume park(s)`)
    }
    return removed
  }

  const keepResumeConflict = (sessionId: string): void => {
    waits.setSendConflict(sessionId, false)
    const agent = ctx.agents?.get?.(sessionId)
    if (agent !== undefined) scheduleRelease(sessionId, agent)
  }

  const scheduleRelease = (sessionId: string, agent: any) => {
    // Remirror durable inbox payloads before pruning legacy id-only ghosts.
    if (waits.list(sessionId).some(row => row.inboxMessageId !== undefined)) {
      restoreInboxParks(sessionId, agent)
    } else {
      reconcileInboxParks(sessionId, agent)
    }
    clearTimer(sessionId)
    const hasSoft = waits.hasParked(sessionId)
    const hasInbox = (inboxParks.get(sessionId)?.size ?? 0) > 0
      || waits.inboxMessageIds(sessionId).length > 0
    if (!hasSoft && !hasInbox) {
      waits.clear(sessionId)
      return
    }
    // Hold auto-release until the user resolves resume-vs-new-send.
    if (waits.hasSendConflict(sessionId)) {
      const providerId = resolveSessionProvider(agent, ctx)
      const until = nextAllowedInstant(new Date(), providers.policy(providerId))
      waits.refresh(sessionId, until, providerId)
      return
    }
    const providerId = resolveSessionProvider(agent, ctx)
    const policy = providers.policy(providerId)
    const now = new Date()
    if (!sessions.get(sessionId).enabled || !shouldDefer(now, policy)) {
      if (agent.status === 'running' && hasSoft && !hasInbox) {
        waits.refresh(sessionId, nextAllowedInstant(now, policy))
        timers.set(sessionId, setTimeout(() => {
          timers.delete(sessionId)
          const live = ctx.agents?.get?.(sessionId)
          // Keep durable parks when the agent is temporarily gone (Host restart).
          if (live === undefined) return
          scheduleRelease(sessionId, live)
        }, 1_000))
        return
      }
      release(sessionId)
      return
    }
    const until = nextAllowedInstant(now, policy)
    waits.refresh(sessionId, until)
    const delay = Math.min(Math.max(0, until.getTime() - Date.now()) + 25, 60_000)
    timers.set(sessionId, setTimeout(() => {
      timers.delete(sessionId)
      const live = ctx.agents?.get?.(sessionId)
      // Keep durable parks when the agent is temporarily gone (Host restart).
      if (live === undefined) return
      scheduleRelease(sessionId, live)
    }, delay))
  }

  const resumeWaitingSession = (sessionId: string, agent: any) => {
    restoreInboxParks(sessionId, agent)
    const hasSoft = waits.hasParked(sessionId)
    const hasInbox = (inboxParks.get(sessionId)?.size ?? 0) > 0
      || waits.inboxMessageIds(sessionId).length > 0
    const hasWait = waits.get(sessionId) !== undefined
    if (!hasSoft && !hasInbox && !hasWait) return
    scheduleRelease(sessionId, agent)
    if (agent.status === 'running') armWindowEndWatch(sessionId, agent)
  }

  const parkMessage = (agent: any, message: unknown, via: 'followup' | 'steer') => {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return false
    const providerId = resolveSessionProvider(agent, ctx)
    const pair = originals.get(agent)
    const hadResume = waits.hasResume(sessionId)
    const until = nextAllowedInstant(new Date(), providers.policy(providerId))
    const notice = isJobCompletionNotice(message)

    // Idle: durable soft park + inbox mirror for QueueDock.
    // tool-jobs completion notices skip inbox so users never see them in QueueDock.
    if (!notice
      && agent.status === 'idle'
      && pair !== undefined
      && typeof pair.send === 'function') {
      const row = waits.enqueue(sessionId, message, until, providerId, 'user')
      pair.send(message, 'next-turn', false)
      const inboxId = messageIdOf(message)
      if (inboxId !== undefined) {
        waits.bindInboxMessageId(sessionId, row.id, inboxId)
        noteInboxPark(sessionId, message)
      }
      if (hadResume) waits.setSendConflict(sessionId, true)
      logger?.info?.(
        `[dsh-offpeak-job] session ${sessionId} provider ${providerId}: soft+inbox-parked ${via}${
          hadResume ? ' behind resume' : ''
        } ${row.id} until ${until.toISOString()}`,
      )
      scheduleRelease(sessionId, agent)
      return true
    }

    const kind = notice ? 'notice' : 'user'
    const row = waits.enqueue(sessionId, message, until, providerId, kind)
    if (hadResume && !notice) waits.setSendConflict(sessionId, true)
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId} provider ${providerId}: soft-parked ${via}${
        notice ? ' job notice' : hadResume ? ' behind resume' : ''
      } ${row.id} until ${until.toISOString()}`,
    )
    scheduleRelease(sessionId, agent)
    return true
  }

  const wrap = (agent: any) => {
    if (agent == null || typeof agent !== 'object') return
    if (agent[WRAPPED] === true) return
    if (typeof agent.followup !== 'function' || typeof agent.steer !== 'function') return
    if (typeof agent.send !== 'function') return
    agent[WRAPPED] = true
    const followup = agent.followup.bind(agent)
    const steer = agent.steer.bind(agent)
    const send = agent.send.bind(agent)
    originals.set(agent, { followup, steer, send })
    agent.followup = (message: unknown) => {
      const sessionId = sessionIdOf(agent)
      if (sessionId !== undefined && waits.hasResume(sessionId) && agent[RELEASING] !== true) {
        parkMessage(agent, message, 'followup')
        return
      }
      if (shouldPark(agent)) {
        parkMessage(agent, message, 'followup')
        return
      }
      followup(message)
    }
    agent.steer = (message: unknown) => {
      if (agent.status === 'idle' && shouldPark(agent)) {
        parkMessage(agent, message, 'steer')
        return
      }
      steer(message)
    }

    const sessionId = sessionIdOf(agent)
    const inbox = agent.inbox
    if (sessionId !== undefined && inbox != null && typeof inbox.remove === 'function'
      && inbox[INBOX_WRAPPED] !== true) {
      inbox[INBOX_WRAPPED] = true
      const remove = inbox.remove.bind(inbox)
      inbox.remove = (id: string) => {
        const result = remove(id)
        if (result !== false) forgetInboxPark(sessionId, id)
        return result
      }
      if (typeof inbox.clear === 'function') {
        const clear = inbox.clear.bind(inbox)
        inbox.clear = () => {
          const tracked = takeInboxParks(sessionId)
          clear()
          if (tracked.length > 0) clearWaitIfIdle(sessionId)
        }
      }
    }
  }

  for (const agent of ctx.agents?.list?.() ?? []) wrap(agent)

  // Rehydrate durable parks after wrapping live agents (Host restart recovery).
  for (const sessionId of waits.waitingSessionIds()) {
    const agent = ctx.agents?.get?.(sessionId)
    if (agent !== undefined) resumeWaitingSession(sessionId, agent)
  }

  const offCreated = ctx.on?.('agent/created', (payload: any) => {
    const agent = payload?.agent
    wrap(agent)
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) resumeWaitingSession(sessionId, agent)
  })

  const offStatus = ctx.on?.('agent/status', (payload: any) => {
    const agent = payload?.agent
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    const status = payload?.status

    if (status === 'running') {
      armWindowEndWatch(sessionId, agent)
      return
    }

    if (status !== 'idle') return

    clearWindowEndTimer(sessionId)
    manualPauseBypass.delete(sessionId)
    if (resumeAborting.has(sessionId)) {
      parkResumeAfterCancel(sessionId, agent)
      return
    }

    if (!waits.hasParked(sessionId) && (inboxParks.get(sessionId)?.size ?? 0) === 0) return
    scheduleRelease(sessionId, agent)
  })

  const offConfig = sessions.subscribe((sessionId, next, prev) => {
    if (prev.enabled && !next.enabled) {
      clearWindowEndTimer(sessionId)
      resumeAborting.delete(sessionId)
      release(sessionId)
      return
    }
    if (!prev.enabled && next.enabled) {
      const agent = ctx.agents?.get?.(sessionId)
      if (agent !== undefined) {
        scheduleRelease(sessionId, agent)
        if (agent.status === 'running') armWindowEndWatch(sessionId, agent)
      }
    }
  })

  const sessionsWaitingForProvider = (providerId: string): string[] => {
    const ids = new Set<string>()
    for (const sessionId of waits.waitingSessionIds()) {
      const tagged = waits.get(sessionId)?.providerId
      if (tagged === providerId) {
        ids.add(sessionId)
        continue
      }
      if (tagged !== undefined) continue
      const agent = ctx.agents?.get?.(sessionId)
      if (agent !== undefined && resolveSessionProvider(agent, ctx) === providerId) {
        ids.add(sessionId)
      }
    }
    for (const sessionId of inboxParks.keys()) {
      if (ids.has(sessionId)) continue
      const tagged = waits.get(sessionId)?.providerId
      if (tagged === providerId) {
        ids.add(sessionId)
        continue
      }
      const agent = ctx.agents?.get?.(sessionId)
      if (agent !== undefined && resolveSessionProvider(agent, ctx) === providerId) {
        ids.add(sessionId)
      }
    }
    return [...ids]
  }

  const countWaitingForProvider = (providerId: string): number =>
    sessionsWaitingForProvider(providerId).length

  const releaseForProvider = (providerId: string): number => {
    let count = 0
    for (const sessionId of sessionsWaitingForProvider(providerId)) {
      count += release(sessionId)
    }
    if (count > 0) {
      logger?.info?.(
        `[dsh-offpeak-job] provider ${providerId}: released ${count} parked message(s) after peak feature off`,
      )
    }
    return count
  }

  const reevaluateForProvider = (providerId: string): number => {
    providers.reload()
    const policy = providers.policy(providerId)
    const chipOn = providers.get(providerId).chipVisible !== false
    const now = new Date()
    let count = 0
    for (const sessionId of sessionsWaitingForProvider(providerId)) {
      const agent = ctx.agents?.get?.(sessionId)
      const mayRun = !chipOn
        || !sessions.get(sessionId).enabled
        || !shouldDefer(now, policy)
      if (mayRun) {
        count += release(sessionId)
        continue
      }
      if (agent !== undefined) {
        scheduleRelease(sessionId, agent)
      } else {
        waits.refresh(sessionId, nextAllowedInstant(now, policy), providerId)
      }
    }
    for (const agent of ctx.agents?.list?.() ?? []) {
      const sessionId = sessionIdOf(agent)
      if (sessionId === undefined) continue
      if (resolveSessionProvider(agent, ctx) !== providerId) continue
      if (agent.status === 'running') armWindowEndWatch(sessionId, agent)
      else clearWindowEndTimer(sessionId)
    }
    if (count > 0) {
      logger?.info?.(
        `[dsh-offpeak-job] provider ${providerId}: released ${count} parked message(s) after schedule change`,
      )
    }
    return count
  }

  return {
    dispose: () => {
      for (const sessionId of [...timers.keys()]) clearTimer(sessionId)
      for (const sessionId of [...windowEndTimers.keys()]) clearWindowEndTimer(sessionId)
      resumeAborting.clear()
      manualPauseBypass.clear()
      if (typeof offCreated === 'function') offCreated()
      if (typeof offStatus === 'function') offStatus()
      offConfig()
    },
    release,
    discard,
    discardResume,
    keepResumeConflict,
    releaseForProvider,
    reevaluateForProvider,
    countWaitingForProvider,
  }
}
