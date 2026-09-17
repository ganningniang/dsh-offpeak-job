/**
 * Per-session off-peak toggle under $DSH_HOME/offpeak-job/sessions.json.
 * Schedule windows and approval policy live on the provider store.
 * Legacy session `approvalPolicy` fields are retained on disk but ignored at runtime.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { parseOffpeakApprovalPolicy } from './approval-policy.ts'
import type {
  OffpeakApprovalPolicy,
  SessionConfigStoreFile,
  SessionOffpeakConfig,
} from './types.ts'

const STORE_VERSION = 4

function defaultStorePath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const next = join(home, 'offpeak-job', 'sessions.json')
  const legacy = join(home, 'offpeak-queue', 'sessions.json')
  if (!existsSync(next) && existsSync(legacy)) {
    mkdirSync(dirname(next), { recursive: true })
    try {
      renameSync(legacy, next)
    } catch {
      // Fall through; load will treat missing as empty.
    }
  }
  return next
}

function normalize(raw: Partial<SessionOffpeakConfig> & Record<string, unknown>): SessionOffpeakConfig {
  const approvalPolicy = parseOffpeakApprovalPolicy(raw.approvalPolicy)
  return {
    enabled: raw.enabled === true,
    ...(approvalPolicy !== undefined ? { approvalPolicy } : {}),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export type SessionConfigListener = (
  sessionId: string,
  next: SessionOffpeakConfig,
  prev: SessionOffpeakConfig,
) => void

export class SessionConfigStore {
  private sessions: Record<string, SessionOffpeakConfig> = {}
  private readonly listeners = new Set<SessionConfigListener>()
  readonly path: string

  constructor(path: string = defaultStorePath()) {
    this.path = path
    this.load()
  }

  /**
   * Subscribe to session toggle writes.
   * @param listener - called after each successful {@link set}.
   * @returns disposer.
   */
  subscribe(listener: SessionConfigListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * @returns every session id that has a stored off-peak config row.
   */
  ids(): string[] {
    return Object.keys(this.sessions)
  }

  get(sessionId: string): SessionOffpeakConfig {
    const existing = this.sessions[sessionId]
    if (existing) {
      return {
        ...existing,
        ...(existing.approvalPolicy !== undefined
          ? { approvalPolicy: existing.approvalPolicy }
          : {}),
      }
    }
    return { enabled: false, updatedAt: new Date(0).toISOString() }
  }

  /**
   * True when this session has never stored an approvalPolicy (eligible to inherit).
   * @param sessionId - session to inspect.
   */
  lacksApprovalPolicy(sessionId: string): boolean {
    return this.sessions[sessionId]?.approvalPolicy === undefined
  }

  set(
    sessionId: string,
    patch: Partial<Pick<SessionOffpeakConfig, 'enabled' | 'approvalPolicy'>>,
  ): SessionOffpeakConfig {
    const prev = this.get(sessionId)
    const nextPolicy = patch.approvalPolicy !== undefined
      ? parseOffpeakApprovalPolicy(patch.approvalPolicy)
      : prev.approvalPolicy
    const next: SessionOffpeakConfig = {
      enabled: patch.enabled ?? prev.enabled,
      ...(nextPolicy !== undefined ? { approvalPolicy: nextPolicy as OffpeakApprovalPolicy } : {}),
      updatedAt: new Date().toISOString(),
    }
    this.sessions[sessionId] = next
    this.save()
    const snapshot = this.get(sessionId)
    for (const listener of this.listeners) listener(sessionId, snapshot, prev)
    return snapshot
  }

  /**
   * Drop a session row entirely (orphan discard / cleanup).
   * @param sessionId - session to remove.
   * @returns true when a row was present.
   */
  remove(sessionId: string): boolean {
    if (this.sessions[sessionId] === undefined) return false
    const prev = this.get(sessionId)
    delete this.sessions[sessionId]
    this.save()
    const cleared: SessionOffpeakConfig = {
      enabled: false,
      updatedAt: new Date().toISOString(),
    }
    for (const listener of this.listeners) listener(sessionId, cleared, prev)
    return true
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.sessions = {}
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as SessionConfigStoreFile
      const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {}
      this.sessions = {}
      for (const [id, value] of Object.entries(sessions)) {
        this.sessions[id] = normalize(value as SessionOffpeakConfig)
      }
    } catch {
      this.sessions = {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const body: SessionConfigStoreFile = { version: STORE_VERSION, sessions: this.sessions }
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }
}
