/**
 * Cross-session off-peak overview for the sidebar panel and badge.
 * Lists Off-peak-run sessions and their live status (not a policy editor).
 */

import type { SessionConfigStore } from './store.ts'
import type { ProviderScheduleStore } from './provider-store.ts'
import type { WaitStateStore } from './wait-state.ts'
import { resolveOffpeakApprovalPolicy } from './approval-policy.ts'
import type { OffpeakApprovalPolicy } from './types.ts'

/** Coarse row status for the overview list. */
export type OverviewStatus =
  | 'waiting'
  | 'resume'
  | 'approval'
  | 'running'
  | 'idle'
  | 'conflict'
  | 'orphan'

export interface OverviewSessionRow {
  sessionId: string
  enabled: boolean
  providerId: string | null
  status: OverviewStatus
  waitingUntil: string | null
  parkedUser: number
  parkedResume: number
  parkedNotice: number
  /** Provider-owned policy (informational; not edited in overview). */
  approvalPolicy: OffpeakApprovalPolicy
  sendConflict: boolean
  textPreview: string
  agentStatus: string | null
  /** True when durable wait/park exists but no live agent. */
  orphan: boolean
  /** True when a tool approval is unanswered. */
  approvalPending: boolean
  /** True when Start now / Discard pending apply (waiting for idle window). */
  windowWait: boolean
}

export interface OverviewResponse {
  /** False when every provider has peak/off-peak turned off — Client hides the sidebar entry. */
  entryVisible: boolean
  badgeCount: number
  sessions: OverviewSessionRow[]
  generatedAt: string
}

export interface OverviewAgentInfo {
  status?: string
  providerId?: string
}

export interface OverviewHooks {
  agentOf?: (sessionId: string) => OverviewAgentInfo | undefined
  hasApprovalPending?: (sessionId: string) => boolean
}

/**
 * Build the overview payload from durable stores + live agents.
 * Only sessions with Off-peak run enabled are listed.
 * @param sessions - session toggle store.
 * @param providers - provider schedule store.
 * @param waits - durable wait / park store.
 * @param hooks - live agent + pending-approval lookups.
 */
export function buildOverview(
  sessions: SessionConfigStore,
  providers: ProviderScheduleStore,
  waits: WaitStateStore,
  hooks: OverviewHooks = {},
): OverviewResponse {
  providers.reload()
  const entryVisible = providers.anyOffpeakEnabled()
  const { agentOf, hasApprovalPending } = hooks
  if (!entryVisible) {
    return {
      entryVisible: false,
      badgeCount: 0,
      sessions: [],
      generatedAt: new Date().toISOString(),
    }
  }
  const ids = new Set<string>([
    ...sessions.ids(),
    ...waits.waitingSessionIds(),
  ])
  const rows: OverviewSessionRow[] = []

  for (const sessionId of ids) {
    const config = sessions.get(sessionId)
    if (!config.enabled) continue

    const wait = waits.get(sessionId)
    const parks = waits.list(sessionId)
    const parkedUser = parks.filter(row => row.kind === 'user').length
    const parkedResume = parks.filter(row => row.kind === 'resume').length
    const parkedNotice = parks.filter(row => row.kind === 'notice').length
    const hasWaitMarker = wait !== undefined
    const inboxIds = waits.inboxMessageIds(sessionId).length
    const agentLookup = typeof agentOf === 'function'
    const agent = agentLookup ? agentOf(sessionId) : undefined
    const providerId = wait?.providerId
      ?? agent?.providerId
      ?? null
    const approvalPolicy = resolveOffpeakApprovalPolicy(
      providerId !== null
        ? providers.get(providerId).defaultApprovalPolicy
        : undefined,
    )
    const sendConflict = wait?.sendConflict === true
    const previewRow = parks.find(row => row.kind === 'resume')
      ?? parks.find(row => row.kind === 'user')
      ?? parks[0]
    const textPreview = previewRow?.textPreview ?? ''
    const hasQueue = hasWaitMarker || parks.length > 0 || inboxIds > 0
    const windowWait = parkedUser > 0 || parkedResume > 0 || hasWaitMarker || inboxIds > 0
    const orphan = agentLookup && agent === undefined && hasQueue
    const approvalPending = hasApprovalPending?.(sessionId) === true

    let status: OverviewStatus = 'idle'
    if (orphan) status = 'orphan'
    else if (sendConflict) status = 'conflict'
    else if (approvalPending) status = 'approval'
    else if (parkedResume > 0) status = 'resume'
    else if (parkedUser > 0 || inboxIds > 0 || hasWaitMarker) status = 'waiting'
    else if (agent?.status === 'running') status = 'running'
    else status = 'idle'

    rows.push({
      sessionId,
      enabled: true,
      providerId,
      status,
      waitingUntil: wait?.waitingUntil ?? null,
      parkedUser,
      parkedResume,
      parkedNotice,
      approvalPolicy,
      sendConflict,
      textPreview,
      agentStatus: typeof agent?.status === 'string' ? agent.status : null,
      orphan,
      approvalPending,
      windowWait,
    })
  }

  rows.sort((a, b) => statusRank(a.status) - statusRank(b.status)
    || a.sessionId.localeCompare(b.sessionId))

  const badgeCount = rows.filter(row =>
    row.status === 'waiting'
    || row.status === 'resume'
    || row.status === 'conflict'
    || row.status === 'orphan'
    || row.status === 'approval').length

  return {
    entryVisible: true,
    badgeCount,
    sessions: rows,
    generatedAt: new Date().toISOString(),
  }
}

function statusRank(status: OverviewStatus): number {
  switch (status) {
    case 'orphan': return 0
    case 'conflict': return 1
    case 'approval': return 2
    case 'resume': return 3
    case 'waiting': return 4
    case 'running': return 5
    case 'idle': return 6
    default: return 9
  }
}
