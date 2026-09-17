/**
 * Off-peak park queue: soft-held messages + next-run marker.
 * Soft parks are the durable source of truth (including idle user parks).
 * Idle parks may also mirror into the live agent inbox for QueueDock; the
 * mirror id is stored on the park row so Host restart can re-send the payload
 * when the process-local inbox is empty.
 * State is durable under `$DSH_HOME/offpeak-job/waits.json`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  PersistedParkedMessage,
  PersistedSessionWait,
  WaitStoreFile,
} from './types.ts'

export type ParkKind = 'user' | 'resume' | 'notice'

export interface ParkedMessage {
  /** Stable id for dock remove / cancel-one. */
  id: string
  /** Original followup/steer payload; re-delivered on release. */
  message: unknown
  /** Short text preview for the WaitDock. */
  textPreview: string
  /** Wall-clock when this item was parked (ISO). */
  parkedAt: string
  /** `resume` = window-end continuation; `user` = deferred send; `notice` = hidden tool-jobs completion. */
  kind: ParkKind
  /**
   * When set, this soft park is mirrored in the agent inbox (`send` without wake)
   * so QueueDock can show the row. Host restart re-mirrors from {@link message}.
   */
  inboxMessageId?: string
}

export interface SessionWait {
  /** ISO instant the park will auto-release after. */
  waitingUntil: string
  /** Wall-clock when the session first gained a parked item (ISO). */
  startedAt: string
  /** Provider whose schedule caused this wait (for disable → flush). */
  providerId?: string
  /**
   * User sent while a resume park is held; Client should confirm keep vs discard.
   */
  sendConflict?: boolean
  /** Tracked inbox park message ids (idle send without wake). */
  inboxMessageIds?: string[]
}

const STORE_VERSION = 1

function defaultStorePath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'offpeak-job', 'waits.json')
}

function textPreviewOf(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  const text = content
    .filter((part): part is { type: 'text'; text: string } =>
      part !== null
      && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string')
    .map(part => part.text)
    .join('')
    .trim()
  if (text.length <= 160) return text
  return `${text.slice(0, 157)}…`
}

function isParkKind(value: unknown): value is ParkKind {
  return value === 'user' || value === 'resume' || value === 'notice'
}

/** Drop values that cannot round-trip through JSON (keeps the file writable). */
function jsonClone(value: unknown): unknown | undefined {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return undefined
  }
}

function parseParkIdSeq(id: string): number {
  const match = /^park-(\d+)$/.exec(id)
  if (match === null) return 0
  const n = Number(match[1])
  return Number.isFinite(n) ? n : 0
}

export type WaitPersistSkip = (detail: {
  sessionId: string
  parkId: string
  reason: 'non-json'
}) => void

export class WaitStateStore {
  readonly #bySession = new Map<string, SessionWait>()
  readonly #parked = new Map<string, ParkedMessage[]>()
  #seq = 0
  readonly path: string
  readonly #onPersistSkip?: WaitPersistSkip

  constructor(path?: string, onPersistSkip?: WaitPersistSkip) {
    this.path = path ?? defaultStorePath()
    this.#onPersistSkip = onPersistSkip
    this.load()
  }

  /**
   * Park one user message without waking the agent.
   * @param sessionId - session that owns the message.
   * @param message - followup/steer UserMessage payload.
   * @param waitingUntil - next allowed release instant.
   * @param providerId - provider whose schedule deferred this message.
   * @param kind - park classification (default user).
   * @param inboxMessageId - optional live inbox id when mirrored for QueueDock.
   * @returns the parked row.
   */
  enqueue(
    sessionId: string,
    message: unknown,
    waitingUntil: Date,
    providerId?: string,
    kind: ParkKind = 'user',
    inboxMessageId?: string,
  ): ParkedMessage {
    this.#seq += 1
    const row: ParkedMessage = {
      id: `park-${this.#seq}`,
      message,
      textPreview: textPreviewOf(message),
      parkedAt: new Date().toISOString(),
      kind,
      ...(inboxMessageId !== undefined && inboxMessageId.length > 0
        ? { inboxMessageId }
        : {}),
    }
    const list = this.#parked.get(sessionId) ?? []
    list.push(row)
    this.#parked.set(sessionId, list)
    this.begin(sessionId, waitingUntil, providerId)
    this.#syncInboxIdsFromParks(sessionId)
    this.persist()
    return row
  }

  /**
   * Bind (or refresh) the live inbox mirror id on an existing soft park.
   * @param sessionId - session that owns the park.
   * @param parkId - {@link ParkedMessage.id}.
   * @param inboxMessageId - id currently held in `agent.inbox.nextTurn`.
   * @returns true when the park row was updated.
   */
  bindInboxMessageId(sessionId: string, parkId: string, inboxMessageId: string): boolean {
    if (inboxMessageId.length === 0) return false
    const list = this.#parked.get(sessionId)
    if (list === undefined) return false
    const row = list.find(item => item.id === parkId)
    if (row === undefined) return false
    if (row.inboxMessageId === inboxMessageId) {
      this.#syncInboxIdsFromParks(sessionId)
      return true
    }
    row.inboxMessageId = inboxMessageId
    this.#syncInboxIdsFromParks(sessionId)
    this.persist()
    return true
  }

  /**
   * Remove the soft park mirrored to a live inbox id (QueueDock delete).
   * @param sessionId - session that owns the park.
   * @param inboxMessageId - live inbox message id.
   * @returns the removed row, or undefined when no mirror matched.
   */
  takeByInboxMessageId(sessionId: string, inboxMessageId: string): ParkedMessage | undefined {
    const list = this.#parked.get(sessionId)
    if (list === undefined) return undefined
    const index = list.findIndex(row => row.inboxMessageId === inboxMessageId)
    if (index < 0) return undefined
    const [row] = list.splice(index, 1)
    if (list.length === 0) {
      this.#parked.delete(sessionId)
    } else {
      this.#parked.set(sessionId, list)
    }
    const existing = this.#bySession.get(sessionId)
    if (existing !== undefined) {
      const fromParks = this.mirroredInboxIds(sessionId)
      const next = [...new Set([
        ...fromParks,
        ...(existing.inboxMessageIds ?? []).filter(id => id !== inboxMessageId),
      ])]
      this.#bySession.set(sessionId, {
        ...existing,
        inboxMessageIds: next.length > 0 ? next : undefined,
      })
    }
    this.persist()
    return row
  }

  /**
   * Inbox mirror ids derived from soft parks.
   * @param sessionId - session to inspect.
   */
  mirroredInboxIds(sessionId: string): readonly string[] {
    const fromParks = (this.#parked.get(sessionId) ?? [])
      .map(row => row.inboxMessageId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return [...new Set(fromParks)]
  }

  /**
   * @param sessionId - session whose turn is deferred.
   * @param waitingUntil - next allowed instant.
   * @param providerId - provider whose schedule deferred this session.
   */
  begin(sessionId: string, waitingUntil: Date, providerId?: string): void {
    const existing = this.#bySession.get(sessionId)
    this.#bySession.set(sessionId, {
      waitingUntil: waitingUntil.toISOString(),
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      providerId: providerId ?? existing?.providerId,
      sendConflict: existing?.sendConflict,
      inboxMessageIds: existing?.inboxMessageIds,
    })
    this.persist()
  }

  /**
   * Refresh the advertised next-run instant while the same wait continues.
   * @param sessionId - session still waiting.
   * @param waitingUntil - updated next allowed instant.
   * @param providerId - optional provider refresh when known.
   */
  refresh(sessionId: string, waitingUntil: Date, providerId?: string): void {
    const existing = this.#bySession.get(sessionId)
    if (existing === undefined) {
      this.begin(sessionId, waitingUntil, providerId)
      return
    }
    this.#bySession.set(sessionId, {
      ...existing,
      waitingUntil: waitingUntil.toISOString(),
      providerId: providerId ?? existing.providerId,
    })
    this.persist()
  }

  /**
   * Mark that a new user send arrived while a resume park is held.
   * @param sessionId - session with the conflict.
   */
  setSendConflict(sessionId: string, conflict: boolean): void {
    const existing = this.#bySession.get(sessionId)
    if (existing === undefined) {
      if (!conflict) return
      this.#bySession.set(sessionId, {
        waitingUntil: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        sendConflict: true,
      })
      this.persist()
      return
    }
    this.#bySession.set(sessionId, { ...existing, sendConflict: conflict || undefined })
    this.persist()
  }

  /**
   * Replace tracked inbox park ids for a session (idle send without wake).
   * Always unions with park {@link ParkedMessage.inboxMessageId} mirrors so a
   * memory-only sync cannot drop durable mirror ids.
   * @param sessionId - session that owns the inbox parks.
   * @param ids - message ids currently held in the agent inbox for this wait.
   */
  setInboxMessageIds(sessionId: string, ids: readonly string[]): void {
    const fromParks = this.mirroredInboxIds(sessionId)
    const unique = [...new Set([
      ...fromParks,
      ...ids.filter(id => id.length > 0),
    ])]
    const existing = this.#bySession.get(sessionId)
    if (existing === undefined) {
      if (unique.length === 0) return
      this.#bySession.set(sessionId, {
        waitingUntil: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        inboxMessageIds: unique,
      })
      this.persist()
      return
    }
    const prev = existing.inboxMessageIds ?? []
    if (prev.length === unique.length && prev.every((id, i) => id === unique[i])) return
    this.#bySession.set(sessionId, {
      ...existing,
      inboxMessageIds: unique.length > 0 ? unique : undefined,
    })
    this.persist()
  }

  /**
   * @param sessionId - session to inspect.
   * @returns durable inbox park ids (park mirrors ∪ wait-level legacy ids).
   */
  inboxMessageIds(sessionId: string): readonly string[] {
    const fromParks = this.mirroredInboxIds(sessionId)
    const fromWait = this.#bySession.get(sessionId)?.inboxMessageIds ?? []
    return [...new Set([...fromParks, ...fromWait])]
  }

  /**
   * @param sessionId - session to inspect.
   * @returns true when Client should show the resume-vs-new-send dialog.
   */
  hasSendConflict(sessionId: string): boolean {
    return this.#bySession.get(sessionId)?.sendConflict === true
  }

  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one resume park is held.
   */
  hasResume(sessionId: string): boolean {
    return (this.#parked.get(sessionId) ?? []).some(row => row.kind === 'resume')
  }

  /**
   * Drop resume parks only; leave user parks and clear sendConflict.
   * @param sessionId - session to edit.
   * @returns number of resume rows removed.
   */
  discardResume(sessionId: string): number {
    const list = this.#parked.get(sessionId)
    if (list === undefined) {
      this.setSendConflict(sessionId, false)
      return 0
    }
    const kept = list.filter(row => row.kind !== 'resume')
    const removed = list.length - kept.length
    if (kept.length === 0) {
      this.#parked.delete(sessionId)
    } else {
      this.#parked.set(sessionId, kept)
    }
    this.#syncInboxIdsFromParks(sessionId)
    this.setSendConflict(sessionId, false)
    this.persist()
    return removed
  }

  /**
   * Take every parked message and clear the wait marker.
   * @param sessionId - session to drain.
   * @returns parked rows in admission order.
   */
  takeAll(sessionId: string): ParkedMessage[] {
    const list = this.#parked.get(sessionId) ?? []
    this.#parked.delete(sessionId)
    this.#bySession.delete(sessionId)
    this.persist()
    return list
  }

  /**
   * Remove one parked row; clears the wait marker when the queue empties.
   * @param sessionId - session that owns the row.
   * @param itemId - {@link ParkedMessage.id}.
   * @returns the removed row, or undefined when missing.
   */
  takeOne(sessionId: string, itemId: string): ParkedMessage | undefined {
    const list = this.#parked.get(sessionId)
    if (list === undefined) return undefined
    const index = list.findIndex(row => row.id === itemId)
    if (index < 0) return undefined
    const [row] = list.splice(index, 1)
    if (list.length === 0) {
      this.#parked.delete(sessionId)
      this.#bySession.delete(sessionId)
    } else {
      this.#parked.set(sessionId, list)
      this.#syncInboxIdsFromParks(sessionId)
    }
    this.persist()
    return row
  }

  /**
   * @param sessionId - session whose wait ended without draining (legacy clear).
   */
  clear(sessionId: string): void {
    const had = this.#parked.has(sessionId) || this.#bySession.has(sessionId)
    this.#parked.delete(sessionId)
    this.#bySession.delete(sessionId)
    if (had) this.persist()
  }

  /**
   * @param sessionId - session to inspect.
   * @returns live wait marker, or undefined when not waiting.
   */
  get(sessionId: string): SessionWait | undefined {
    return this.#bySession.get(sessionId)
  }

  /**
   * @param sessionId - session to inspect.
   * @returns parked rows (copies of metadata; message refs unchanged).
   */
  list(sessionId: string): readonly ParkedMessage[] {
    return this.#parked.get(sessionId) ?? []
  }

  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one message is parked.
   */
  hasParked(sessionId: string): boolean {
    return (this.#parked.get(sessionId)?.length ?? 0) > 0
  }

  /**
   * @returns session ids that currently have a wait marker or soft park.
   */
  waitingSessionIds(): string[] {
    return [...new Set([...this.#bySession.keys(), ...this.#parked.keys()])]
  }

  /**
   * @param providerId - provider to match.
   * @returns how many sessions are waiting under that provider.
   */
  countWaitingForProvider(providerId: string): number {
    let count = 0
    for (const id of this.waitingSessionIds()) {
      const wait = this.#bySession.get(id)
      if (wait?.providerId === providerId) count += 1
    }
    return count
  }

  private load(): void {
    if (!existsSync(this.path)) return
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as WaitStoreFile
      const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {}
      let maxSeq = 0
      for (const [sessionId, value] of Object.entries(sessions)) {
        const row = normalizeSessionWait(value)
        if (row === undefined) continue
        const { parks, ...wait } = row
        this.#bySession.set(sessionId, wait)
        if (parks.length > 0) {
          this.#parked.set(sessionId, parks)
          for (const park of parks) {
            maxSeq = Math.max(maxSeq, parseParkIdSeq(park.id))
          }
          this.#syncInboxIdsFromParks(sessionId)
        }
      }
      this.#seq = maxSeq
    } catch {
      // Corrupt file: start empty; next persist will rewrite.
    }
  }

  /**
   * Align wait-level inboxMessageIds with park mirror ids when mirrors exist.
   * Never wipes legacy id-only lists merely because soft parks lack mirrors.
   */
  #syncInboxIdsFromParks(sessionId: string): void {
    const existing = this.#bySession.get(sessionId)
    if (existing === undefined) return
    const fromParks = this.mirroredInboxIds(sessionId)
    if (fromParks.length === 0) return
    const prev = existing.inboxMessageIds ?? []
    const next = [...new Set([...fromParks, ...prev])]
    if (next.length === prev.length && next.every((id, i) => id === prev[i])) return
    this.#bySession.set(sessionId, {
      ...existing,
      inboxMessageIds: next,
    })
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const sessions: Record<string, PersistedSessionWait> = {}
    const ids = new Set([...this.#bySession.keys(), ...this.#parked.keys()])
    for (const sessionId of ids) {
      const wait = this.#bySession.get(sessionId)
      const parks = this.#parked.get(sessionId) ?? []
      const persistedParks: PersistedParkedMessage[] = []
      for (const park of parks) {
        const message = jsonClone(park.message)
        if (message === undefined) {
          this.#onPersistSkip?.({
            sessionId,
            parkId: park.id,
            reason: 'non-json',
          })
          continue
        }
        persistedParks.push({
          id: park.id,
          kind: park.kind,
          parkedAt: park.parkedAt,
          textPreview: park.textPreview,
          message,
          ...(park.inboxMessageId !== undefined && park.inboxMessageId.length > 0
            ? { inboxMessageId: park.inboxMessageId }
            : {}),
        })
      }
      if (wait === undefined && persistedParks.length === 0) continue
      const inboxFromParks = persistedParks
        .map(row => row.inboxMessageId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      const inboxIds = [...new Set([
        ...inboxFromParks,
        ...(wait?.inboxMessageIds ?? []),
      ])]
      sessions[sessionId] = {
        waitingUntil: wait?.waitingUntil ?? new Date().toISOString(),
        startedAt: wait?.startedAt ?? new Date().toISOString(),
        ...(wait?.providerId !== undefined ? { providerId: wait.providerId } : {}),
        ...(wait?.sendConflict === true ? { sendConflict: true } : {}),
        ...(inboxIds.length > 0 ? { inboxMessageIds: inboxIds } : {}),
        parks: persistedParks,
      }
    }
    const body: WaitStoreFile = { version: STORE_VERSION, sessions }
    const tmp = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }
}

function normalizeSessionWait(
  raw: PersistedSessionWait | Record<string, unknown>,
): (SessionWait & { parks: ParkedMessage[] }) | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const waitingUntil = typeof raw.waitingUntil === 'string' ? raw.waitingUntil : undefined
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : undefined
  if (waitingUntil === undefined || startedAt === undefined) return undefined
  const parksRaw = Array.isArray(raw.parks) ? raw.parks : []
  const parks: ParkedMessage[] = []
  for (const item of parksRaw) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !isParkKind(row.kind)) continue
    if (typeof row.parkedAt !== 'string' || typeof row.textPreview !== 'string') continue
    parks.push({
      id: row.id,
      kind: row.kind,
      parkedAt: row.parkedAt,
      textPreview: row.textPreview,
      message: row.message,
      ...(typeof row.inboxMessageId === 'string' && row.inboxMessageId.length > 0
        ? { inboxMessageId: row.inboxMessageId }
        : {}),
    })
  }
  const inboxRaw = Array.isArray(raw.inboxMessageIds) ? raw.inboxMessageIds : undefined
  const inboxMessageIds = inboxRaw
    ?.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return {
    waitingUntil,
    startedAt,
    providerId: typeof raw.providerId === 'string' ? raw.providerId : undefined,
    sendConflict: raw.sendConflict === true ? true : undefined,
    inboxMessageIds: inboxMessageIds !== undefined && inboxMessageIds.length > 0
      ? inboxMessageIds
      : undefined,
    parks,
  }
}
