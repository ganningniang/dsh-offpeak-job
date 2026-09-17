/** Off-peak schedule types: provider-owned windows + session toggle. */

/** Minutes from local midnight [0, 1440). Overnight windows use startMin > endMin. */
export type WindowDays = 'all' | 'weekdays' | 'weekends'

export interface TimeWindow {
  startMin: number
  endMin: number
  /**
   * Which Shanghai calendar days this idle window covers.
   * Omitted or `all` = every day (legacy custom configs).
   */
  days?: WindowDays
}

/** @deprecated alias — prefer TimeWindow */
export type PeakWindow = TimeWindow

/**
 * `deepseek` — official DeepSeek peak calendar.
 * `custom` — run only inside {@link idleWindows}.
 * `none` — no off-peak restriction (session toggle does not wait).
 */
export type ScheduleKind = 'deepseek' | 'custom' | 'none'

/** Official DeepSeek LLM provider route id. */
export const DEEPSEEK_OFFICIAL_PROVIDER = 'deepseek-official'

/**
 * What happens to a running 谷时会话 turn when the idle window ends.
 * Omitted / legacy configs default to {@link 'continue'}.
 */
export type WindowEndPolicy = 'continue' | 'pause'

/**
 * How unattended Off-peak runs answer tool `approval/request`.
 * Omitted / legacy configs default to `reject`.
 */
export type OffpeakApprovalPolicy = 'reject' | 'wait' | 'allow'

/** Per-provider default schedule (settings Models page). */
export interface ProviderScheduleConfig {
  scheduleKind: ScheduleKind
  /** Custom 谷时 windows; used when scheduleKind is `custom`. */
  idleWindows?: TimeWindow[]
  /**
   * When true, the session composer shows the run-timing chip for this provider.
   * Omitted / legacy files default to true.
   */
  chipVisible: boolean
  /**
   * Running-turn behavior at the idle-window boundary (谷时运行 sessions only).
   * Default {@link 'continue'}.
   */
  windowEndPolicy: WindowEndPolicy
  /**
   * Default idle-run approval policy for Off-peak run sessions on this provider.
   * Session-stored approvalPolicy (if any) is ignored at runtime.
   * Default `reject`.
   */
  defaultApprovalPolicy: OffpeakApprovalPolicy
  updatedAt: string
}

export interface ProviderScheduleStoreFile {
  version: number
  providers: Record<string, ProviderScheduleConfig>
}

/**
 * Session off-peak toggle.
 * Schedule windows and approval policy come from the provider.
 * `approvalPolicy` may still appear in older sessions.json rows; runtime ignores it.
 */
export interface SessionOffpeakConfig {
  enabled: boolean
  /**
   * @deprecated Ignored — provider `defaultApprovalPolicy` is authoritative.
   */
  approvalPolicy?: OffpeakApprovalPolicy
  updatedAt: string
}

export interface SessionConfigStoreFile {
  version: number
  sessions: Record<string, SessionOffpeakConfig>
}

/**
 * One soft-parked follow-up row under `$DSH_HOME/offpeak-job/waits.json`.
 * `message` must be JSON-serializable; non-JSON payloads are dropped on save.
 * Idle parks keep the full payload here and may set {@link inboxMessageId} when
 * mirrored into the live agent inbox for QueueDock.
 */
export interface PersistedParkedMessage {
  id: string
  kind: 'user' | 'resume' | 'notice'
  parkedAt: string
  textPreview: string
  message: unknown
  /**
   * Live inbox message id when this soft park is mirrored via
   * `send(..., wakeup: false)` for QueueDock. Omitted for busy-only soft parks.
   */
  inboxMessageId?: string
}

/** Per-session wait marker + soft parks + tracked inbox message ids. */
export interface PersistedSessionWait {
  waitingUntil: string
  startedAt: string
  providerId?: string
  sendConflict?: boolean
  /**
   * Idle `send(..., wakeup:false)` message ids still held in the agent inbox.
   * Prefer deriving from park `inboxMessageId` fields; retained for legacy rows
   * and in-memory sync.
   */
  inboxMessageIds?: string[]
  parks: PersistedParkedMessage[]
}

/** Durable soft-park / resume / inbox-mirror queue for Host restart recovery. */
export interface WaitStoreFile {
  version: number
  sessions: Record<string, PersistedSessionWait>
}

/** Effective policy used by deferral / status APIs. */
export interface SchedulePolicy {
  scheduleKind: ScheduleKind
  idleWindows?: TimeWindow[]
  providerId: string
}
