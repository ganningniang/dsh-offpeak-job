/**
 * dsh-offpeak-job Host: provider schedules + session toggle + admission park.
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionConfigStore } from './store.ts'
import { ProviderScheduleStore } from './provider-store.ts'
import { WaitStateStore } from './wait-state.ts'
import { ApprovalPendingTracker } from './approval-pending.ts'
import { registerApi } from './api.ts'
import { installOffpeakPark } from './park.ts'
import { installOffpeakApproval } from './approval.ts'
import { resolveSessionProvider } from './resolve-provider.ts'

declare const __OPJ_VERSION__: string
const PLUGIN_VERSION = typeof __OPJ_VERSION__ === 'undefined' ? 'dev' : __OPJ_VERSION__

export const name = 'dsh-offpeak-job'
export const inject = ['webServer', 'agents']

export function apply(ctx: Context): void {
  const webServer = (ctx as any).webServer
  const logger = (ctx as any).logger
  const sessions = new SessionConfigStore()
  const providers = new ProviderScheduleStore()
  const waits = new WaitStateStore(undefined, (detail) => {
    logger?.warn?.(
      `[dsh-offpeak-job] skip non-JSON park ${detail.parkId} for session ${detail.sessionId}`,
    )
  })
  const approvalPending = new ApprovalPendingTracker()

  if (!webServer) {
    logger?.warn?.('[dsh-offpeak-job] ctx.webServer unavailable — skipping Host routes')
    return
  }

  const park = installOffpeakPark(ctx, sessions, providers, waits, logger)
  const disposeApproval = installOffpeakApproval(ctx, sessions, providers, logger)
  const disposePending = approvalPending.install(ctx, logger)

  ctx.effect(() => registerApi(webServer, sessions, providers, waits, {
    cancelWait: (sessionId) => park.discard(sessionId) > 0,
    releaseNow: (sessionId) => park.release(sessionId, { manual: true }) > 0,
    discardResume: (sessionId) => park.discardResume(sessionId) > 0,
    keepResumeConflict: (sessionId) => { park.keepResumeConflict(sessionId) },
    releaseForProvider: (providerId) => park.releaseForProvider(providerId),
    reevaluateForProvider: (providerId) => park.reevaluateForProvider(providerId),
    countWaitingForProvider: (providerId) => park.countWaitingForProvider(providerId),
    agentOf: (sessionId) => {
      const agent = (ctx as any).agents?.get?.(sessionId)
      if (agent === undefined) return undefined
      return {
        status: typeof agent.status === 'string' ? agent.status : undefined,
        providerId: resolveSessionProvider(agent, ctx),
      }
    },
    hasApprovalPending: (sessionId) => approvalPending.hasPending(sessionId),
  }), 'offpeak-job: api')
  ctx.effect(() => () => park.dispose(), 'offpeak-job: park')
  ctx.effect(() => disposeApproval, 'offpeak-job: approval')
  ctx.effect(() => disposePending, 'offpeak-job: approval-pending')

  logger?.info?.(
    `[dsh-offpeak-job] v${PLUGIN_VERSION} ready; sessions ${sessions.path}; providers ${providers.path}; waits ${waits.path}`,
  )
}
