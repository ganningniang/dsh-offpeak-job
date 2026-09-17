/**
 * HTTP API: provider schedules + per-session off-peak toggle + park queue.
 */

import type { SessionConfigStore } from './store.ts'
import type { ProviderScheduleStore } from './provider-store.ts'
import type { WaitStateStore } from './wait-state.ts'
import {
  DEEPSEEK_PEAK_WINDOWS,
  DEFAULT_CUSTOM_IDLE,
  formatWindow,
  isDeepSeekPeak,
  nextAllowedInstant,
  PEAK_WINDOWS_NOTE,
  shouldDefer,
} from './offpeak.ts'
import { DEEPSEEK_OFFICIAL_PROVIDER } from './types.ts'
import {
  parseOffpeakApprovalPolicy,
  resolveOffpeakApprovalPolicy,
} from './approval-policy.ts'
import { buildOverview, type OverviewAgentInfo } from './overview.ts'

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function sessionIdFromPath(pathname: string): string | undefined {
  const m = /^\/api\/offpeak-job\/session\/([^/]+)/.exec(pathname)
  if (!m?.[1]) return undefined
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

function isCancelWaitPath(pathname: string): boolean {
  return /\/cancel-wait\/?$/.test(pathname)
}

function isReleasePath(pathname: string): boolean {
  return /\/release\/?$/.test(pathname)
}

function isResolveSendPath(pathname: string): boolean {
  return /\/resolve-send\/?$/.test(pathname)
}

function providerIdFromPath(pathname: string): string | undefined {
  const m = /^\/api\/offpeak-job\/provider\/([^/]+)\/?$/.exec(pathname)
  if (!m?.[1]) return undefined
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

function providerView(
  store: ProviderScheduleStore,
  providerId: string,
  waitingCount = 0,
) {
  store.reload()
  const config = store.get(providerId)
  const policy = store.policy(providerId)
  const scheduleActive = config.scheduleKind !== 'none'
  const chipVisible = config.chipVisible !== false
  return {
    providerId,
    config,
    isDeepSeekOfficial: providerId === DEEPSEEK_OFFICIAL_PROVIDER,
    scheduleActive,
    chipVisible,
    /** When false, the composer omits the run-timing control entirely. */
    showComposerChip: chipVisible,
    /** Sessions currently parked waiting for this provider's idle windows. */
    waitingCount,
    deferredNow: shouldDefer(new Date(), policy),
    nextOffpeak: nextAllowedInstant(new Date(), policy).toISOString(),
    peakWindowsNote: PEAK_WINDOWS_NOTE,
    defaultPeakWindows: DEEPSEEK_PEAK_WINDOWS,
    defaultCustomIdle: DEFAULT_CUSTOM_IDLE,
    summary: config.scheduleKind === 'deepseek'
      ? PEAK_WINDOWS_NOTE
      : config.scheduleKind === 'none'
        ? 'none'
        : (config.idleWindows ?? []).map(formatWindow).join(', '),
  }
}

function sessionView(
  sessions: SessionConfigStore,
  providers: ProviderScheduleStore,
  waits: WaitStateStore,
  sessionId: string,
  providerId: string,
) {
  const config = sessions.get(sessionId)
  const provider = providerView(providers, providerId)
  const policy = providers.policy(providerId)
  const deferredNow = config.enabled
    && provider.chipVisible
    && provider.scheduleActive
    && shouldDefer(new Date(), policy)
  const wait = waits.get(sessionId)
  const parked = waits.list(sessionId)
    .filter(row => row.kind !== 'notice')
    .map(row => ({
      id: row.id,
      textPreview: row.textPreview,
      parkedAt: row.parkedAt,
      kind: row.kind,
      /** True when mirrored into live inbox for QueueDock (WaitDock should not repeat the preview). */
      inboxMirrored: typeof row.inboxMessageId === 'string' && row.inboxMessageId.length > 0,
    }))
  const resumePending = waits.hasResume(sessionId)
  const approvalPolicy = resolveOffpeakApprovalPolicy(
    provider.config.defaultApprovalPolicy,
  )
  return {
    sessionId,
    providerId,
    config: {
      enabled: config.enabled,
      updatedAt: config.updatedAt,
    },
    provider,
    scheduleActive: provider.scheduleActive,
    chipVisible: provider.chipVisible,
    showComposerChip: provider.showComposerChip,
    deferredNow,
    isPeakNow: deferredNow,
    waitingUntil: wait?.waitingUntil ?? null,
    waitingSince: wait?.startedAt ?? null,
    parked,
    resumePending,
    sendConflict: wait?.sendConflict === true,
    approvalPolicy,
    nextOffpeak: wait?.waitingUntil ?? nextAllowedInstant(new Date(), policy).toISOString(),
    peakWindowsNote: PEAK_WINDOWS_NOTE,
    defaultCustomIdle: DEFAULT_CUSTOM_IDLE,
  }
}

export function registerApi(
  webServer: any,
  sessions: SessionConfigStore,
  providers: ProviderScheduleStore,
  waits: WaitStateStore,
  hooks: {
    cancelWait: (sessionId: string) => boolean
    releaseNow: (sessionId: string) => boolean
    discardResume: (sessionId: string) => boolean
    keepResumeConflict: (sessionId: string) => void
    releaseForProvider: (providerId: string) => number
    reevaluateForProvider: (providerId: string) => number
    countWaitingForProvider: (providerId: string) => number
    agentOf?: (sessionId: string) => OverviewAgentInfo | undefined
    hasApprovalPending?: (sessionId: string) => boolean
  } = {
    cancelWait: () => false,
    releaseNow: () => false,
    discardResume: () => false,
    keepResumeConflict: () => {},
    releaseForProvider: () => 0,
    reevaluateForProvider: () => 0,
    countWaitingForProvider: () => 0,
  },
): () => void {
  const disposers: Array<() => void> = []

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/offpeak-job/overview',
    handler: (_req: any, res: any) => {
      try {
        json(res, 200, buildOverview(sessions, providers, waits, {
          agentOf: hooks.agentOf,
          hasApprovalPending: hooks.hasApprovalPending,
        }))
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/offpeak-job/health',
    handler: (_req: any, res: any) => {
      json(res, 200, {
        ok: true,
        plugin: 'dsh-offpeak-job',
        peakWindowsNote: PEAK_WINDOWS_NOTE,
        defaultPeakWindows: DEEPSEEK_PEAK_WINDOWS,
        defaultCustomIdle: DEFAULT_CUSTOM_IDLE,
        isPeakNow: isDeepSeekPeak(),
        nextOffpeak: nextAllowedInstant().toISOString(),
      })
    },
  }))

  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/api/offpeak-job/provider',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const providerId = providerIdFromPath(url.pathname)
        if (!providerId) {
          json(res, 404, { error: 'missing provider id' })
          return
        }

        if (req.method === 'GET') {
          json(res, 200, providerView(
            providers,
            providerId,
            hooks.countWaitingForProvider(providerId),
          ))
          return
        }

        if (req.method === 'PUT' || req.method === 'PATCH') {
          const body = await readJsonBody(req)
          const prev = providers.get(providerId)
          const kind = body.scheduleKind
          const nextChip = typeof body.chipVisible === 'boolean'
            ? body.chipVisible
            : prev.chipVisible
          providers.set(providerId, {
            scheduleKind: kind === 'custom' || kind === 'deepseek' || kind === 'none'
              ? kind
              : undefined,
            idleWindows: Array.isArray(body.idleWindows) ? body.idleWindows : undefined,
            ...(typeof body.chipVisible === 'boolean' ? { chipVisible: body.chipVisible } : {}),
            ...(body.windowEndPolicy === 'pause' || body.windowEndPolicy === 'continue'
              ? { windowEndPolicy: body.windowEndPolicy }
              : {}),
            ...(() => {
              const policy = parseOffpeakApprovalPolicy(body.defaultApprovalPolicy)
              return policy !== undefined ? { defaultApprovalPolicy: policy } : {}
            })(),
          })
          // Chip off → flush all waits; schedule edit → release only if now idle.
          let released = 0
          if (prev.chipVisible !== false && nextChip === false) {
            released = hooks.releaseForProvider(providerId)
          } else if (nextChip !== false) {
            released = hooks.reevaluateForProvider(providerId)
          }
          json(res, 200, {
            ...providerView(
              providers,
              providerId,
              hooks.countWaitingForProvider(providerId),
            ),
            released,
          })
          return
        }

        json(res, 405, { error: 'method not allowed' })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/api/offpeak-job/session',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = sessionIdFromPath(url.pathname)
        if (!sessionId) {
          json(res, 404, { error: 'missing session id' })
          return
        }

        if (isResolveSendPath(url.pathname)) {
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            const action = body.action === 'discard-resume' ? 'discard-resume' : 'keep-resume'
            if (action === 'discard-resume') {
              hooks.discardResume(sessionId)
            } else {
              hooks.keepResumeConflict(sessionId)
            }
            const providerParam = url.searchParams.get('provider')?.trim() || DEEPSEEK_OFFICIAL_PROVIDER
            json(res, 200, {
              ok: true,
              action,
              ...sessionView(sessions, providers, waits, sessionId, providerParam),
            })
            return
          }
          json(res, 405, { error: 'method not allowed' })
          return
        }

        if (isCancelWaitPath(url.pathname)) {
          if (req.method === 'POST' || req.method === 'DELETE') {
            // Orphan: durable queue but no live agent → discard also clears sessions.json.
            const agentMissing = typeof hooks.agentOf === 'function'
              && hooks.agentOf(sessionId) === undefined
            const hadQueue = waits.get(sessionId) !== undefined
              || waits.hasParked(sessionId)
              || waits.inboxMessageIds(sessionId).length > 0
            const cancelled = hooks.cancelWait(sessionId)
            let removedSession = false
            if (agentMissing && hadQueue) {
              removedSession = sessions.remove(sessionId)
            }
            json(res, 200, {
              ok: true,
              cancelled,
              removedSession,
              waitingUntil: waits.get(sessionId)?.waitingUntil ?? null,
              parked: [],
            })
            return
          }
          json(res, 405, { error: 'method not allowed' })
          return
        }

        if (isReleasePath(url.pathname)) {
          if (req.method === 'POST') {
            const released = hooks.releaseNow(sessionId)
            const providerParam = url.searchParams.get('provider')?.trim() || DEEPSEEK_OFFICIAL_PROVIDER
            json(res, 200, {
              ok: true,
              released,
              ...sessionView(sessions, providers, waits, sessionId, providerParam),
            })
            return
          }
          json(res, 405, { error: 'method not allowed' })
          return
        }

        const providerParam = url.searchParams.get('provider')?.trim()

        if (req.method === 'GET') {
          const providerId = providerParam || DEEPSEEK_OFFICIAL_PROVIDER
          json(res, 200, sessionView(sessions, providers, waits, sessionId, providerId))
          return
        }

        if (req.method === 'PUT' || req.method === 'PATCH') {
          const body = await readJsonBody(req)
          const providerId = (typeof body.provider === 'string' && body.provider.trim())
            || providerParam
            || DEEPSEEK_OFFICIAL_PROVIDER
          // Session approvalPolicy is ignored (provider-owned). Only toggle enabled.
          if (typeof body.enabled === 'boolean') {
            sessions.set(sessionId, { enabled: body.enabled })
          }
          json(res, 200, sessionView(sessions, providers, waits, sessionId, providerId))
          return
        }

        json(res, 405, { error: 'method not allowed' })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  return () => {
    for (const dispose of disposers) dispose()
  }
}
