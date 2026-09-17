/**
 * Per-provider off-peak schedule under $DSH_HOME/offpeak-job/providers.json.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  OffpeakApprovalPolicy,
  ProviderScheduleConfig,
  ProviderScheduleStoreFile,
  ScheduleKind,
  SchedulePolicy,
  TimeWindow,
  WindowEndPolicy,
} from './types.ts'
import { DEEPSEEK_OFFICIAL_PROVIDER } from './types.ts'
import { resolveOffpeakApprovalPolicy } from './approval-policy.ts'
import {
  DEFAULT_CUSTOM_IDLE,
  defaultKindForProvider,
  resolveIdleWindows,
  resolveIdleWindowsForSave,
  sanitizeIdleWindows,
} from './offpeak.ts'

const STORE_VERSION = 1

function defaultStorePath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'offpeak-job', 'providers.json')
}

function normalize(
  providerId: string,
  raw: Partial<ProviderScheduleConfig> & Record<string, unknown>,
): ProviderScheduleConfig {
  const kind: ScheduleKind =
    raw.scheduleKind === 'custom' || raw.scheduleKind === 'deepseek' || raw.scheduleKind === 'none'
      ? raw.scheduleKind
      : defaultKindForProvider(providerId)
  const windowEndPolicy: WindowEndPolicy =
    raw.windowEndPolicy === 'pause' ? 'pause' : 'continue'
  const defaultApprovalPolicy: OffpeakApprovalPolicy =
    resolveOffpeakApprovalPolicy(raw.defaultApprovalPolicy)
  return {
    scheduleKind: kind,
    idleWindows: kind === 'custom'
      ? sanitizeIdleWindows(raw.idleWindows as TimeWindow[] | undefined)
      : undefined,
    // Legacy rows omit the field; keep the composer chip unless explicitly turned off.
    chipVisible: raw.chipVisible !== false,
    windowEndPolicy,
    defaultApprovalPolicy,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export class ProviderScheduleStore {
  private providers: Record<string, ProviderScheduleConfig> = {}
  readonly path: string

  constructor(path: string = defaultStorePath()) {
    this.path = path
    this.load()
  }

  get(providerId: string): ProviderScheduleConfig {
    const existing = this.providers[providerId]
    if (existing) {
      return {
        ...existing,
        idleWindows: existing.idleWindows?.map(w => ({ ...w })),
      }
    }
    return {
      scheduleKind: defaultKindForProvider(providerId),
      chipVisible: true,
      windowEndPolicy: 'continue',
      defaultApprovalPolicy: 'reject',
      updatedAt: new Date(0).toISOString(),
    }
  }

  /**
   * @returns provider ids that have an explicit row in providers.json.
   */
  ids(): string[] {
    return Object.keys(this.providers)
  }

  /**
   * True when at least one provider still has peak/off-peak enabled
   * (`chipVisible` and not `scheduleKind: none`). Empty store uses DeepSeek default.
   */
  anyOffpeakEnabled(): boolean {
    this.reload()
    const ids = this.ids()
    const active = (id: string): boolean => {
      const config = this.get(id)
      return config.chipVisible !== false && config.scheduleKind !== 'none'
    }
    if (ids.length === 0) {
      return active(DEEPSEEK_OFFICIAL_PROVIDER)
    }
    return ids.some(active)
  }

  /** Re-read `$DSH_HOME/.../providers.json` so session UI sees settings Apply writes. */
  reload(): void {
    this.load()
  }

  /** Effective deferral policy for a provider route (overlapping windows merged). */
  policy(providerId: string): SchedulePolicy {
    const config = this.get(providerId)
    return {
      providerId,
      scheduleKind: config.scheduleKind,
      idleWindows: config.scheduleKind === 'custom'
        ? resolveIdleWindows(config.idleWindows)
        : undefined,
    }
  }

  set(
    providerId: string,
    patch: Partial<Pick<
      ProviderScheduleConfig,
      'scheduleKind' | 'idleWindows' | 'chipVisible' | 'windowEndPolicy' | 'defaultApprovalPolicy'
    >>,
  ): ProviderScheduleConfig {
    const prev = this.get(providerId)
    const scheduleKind = patch.scheduleKind ?? prev.scheduleKind
    let idleWindows = prev.idleWindows
    if (patch.idleWindows !== undefined) {
      // Save path: reject zero-duration ranges, then merge overlaps.
      idleWindows = resolveIdleWindowsForSave(patch.idleWindows)
    } else if (scheduleKind === 'custom' && (idleWindows === undefined || idleWindows.length === 0)) {
      idleWindows = [{ ...DEFAULT_CUSTOM_IDLE }]
    }
    if (scheduleKind !== 'custom') idleWindows = undefined

    const next: ProviderScheduleConfig = {
      scheduleKind,
      idleWindows,
      chipVisible: patch.chipVisible ?? prev.chipVisible,
      windowEndPolicy: patch.windowEndPolicy ?? prev.windowEndPolicy,
      defaultApprovalPolicy: patch.defaultApprovalPolicy !== undefined
        ? resolveOffpeakApprovalPolicy(patch.defaultApprovalPolicy)
        : prev.defaultApprovalPolicy,
      updatedAt: new Date().toISOString(),
    }
    this.providers[providerId] = next
    this.save()
    return this.get(providerId)
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.providers = {}
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as ProviderScheduleStoreFile
      const providers = raw.providers && typeof raw.providers === 'object' ? raw.providers : {}
      this.providers = {}
      for (const [id, value] of Object.entries(providers)) {
        this.providers[id] = normalize(id, value as ProviderScheduleConfig)
      }
    } catch {
      this.providers = {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const body: ProviderScheduleStoreFile = { version: STORE_VERSION, providers: this.providers }
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }
}
