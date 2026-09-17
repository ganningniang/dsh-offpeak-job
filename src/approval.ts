/**
 * Host answerer for tool approval during Off-peak run sessions.
 * Does not change the session access-mode / approval `ask`|`never` knob —
 * only claims `approval/request` when the session is Off-peak run.
 * Policy is provider-owned ({@link ProviderScheduleConfig.defaultApprovalPolicy}).
 */

import type { SessionConfigStore } from './store.ts'
import type { ProviderScheduleStore } from './provider-store.ts'
import {
  resolveOffpeakApprovalPolicy,
  type OffpeakApprovalPolicy,
} from './approval-policy.ts'
import { resolveSessionProvider } from './resolve-provider.ts'

export interface ApprovalLogger {
  info?: (msg: string) => void
  warn?: (msg: string) => void
}

type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * Closed decision for Off-peak approval (Run now / wait → delegate).
 * @param enabled - session Off-peak run toggle.
 * @param policy - resolved session/provider policy.
 * @returns Host outcome, or `delegate` to call `next()`.
 */
export function decideOffpeakApproval(
  enabled: boolean,
  policy: OffpeakApprovalPolicy,
): ApprovalOutcome | 'delegate' {
  if (!enabled) return 'delegate'
  switch (policy) {
    case 'reject': return 'rejected'
    case 'allow': return 'allowed-once'
    case 'wait': return 'delegate'
    default: return 'delegate'
  }
}

function sessionIdOf(agent: any): string | undefined {
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Install a prepended `approval/request` answerer for Off-peak run sessions.
 * @returns disposer.
 */
export function installOffpeakApproval(
  ctx: any,
  sessions: SessionConfigStore,
  providers: ProviderScheduleStore,
  logger?: ApprovalLogger,
): () => void {
  if (typeof ctx?.on !== 'function') {
    logger?.warn?.('[dsh-offpeak-job] ctx.on unavailable — skipping approval answerer')
    return () => {}
  }

  const off = ctx.on('approval/request', function (
    this: unknown,
    request: { agent?: any; toolName?: string },
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> | ApprovalOutcome {
    const agent = request?.agent
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return next()

    const config = sessions.get(sessionId)
    // Only Off-peak run sessions; Run now keeps the normal Web answerer.
    if (!config.enabled) return next()

    const providerId = resolveSessionProvider(agent, ctx)
    providers.reload()
    const provider = providers.get(providerId)
    if (provider.chipVisible === false) return next()
    if (providers.policy(providerId).scheduleKind === 'none') return next()

    const policy = resolveOffpeakApprovalPolicy(provider.defaultApprovalPolicy)
    const decision = decideOffpeakApproval(true, policy)
    if (decision === 'delegate') return next()

    const tool = typeof request.toolName === 'string' ? request.toolName : '?'
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId}: auto-${decision === 'rejected' ? 'reject' : 'allow'} approval for ${tool}`,
    )
    return decision
  }, { prepend: true })

  return typeof off === 'function' ? off : () => {}
}
