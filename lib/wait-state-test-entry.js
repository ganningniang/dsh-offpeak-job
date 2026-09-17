// src/wait-state.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
var STORE_VERSION = 1;
function defaultStorePath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "offpeak-job", "waits.json");
}
function textPreviewOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  const text = content.filter((part) => part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("").trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157)}\u2026`;
}
function isParkKind(value) {
  return value === "user" || value === "resume" || value === "notice";
}
function jsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return void 0;
  }
}
function parseParkIdSeq(id) {
  const match = /^park-(\d+)$/.exec(id);
  if (match === null) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
}
var WaitStateStore = class {
  #bySession = /* @__PURE__ */ new Map();
  #parked = /* @__PURE__ */ new Map();
  #seq = 0;
  path;
  #onPersistSkip;
  constructor(path, onPersistSkip) {
    this.path = path ?? defaultStorePath();
    this.#onPersistSkip = onPersistSkip;
    this.load();
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
  enqueue(sessionId, message, waitingUntil, providerId, kind = "user", inboxMessageId) {
    this.#seq += 1;
    const row = {
      id: `park-${this.#seq}`,
      message,
      textPreview: textPreviewOf(message),
      parkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      kind,
      ...inboxMessageId !== void 0 && inboxMessageId.length > 0 ? { inboxMessageId } : {}
    };
    const list = this.#parked.get(sessionId) ?? [];
    list.push(row);
    this.#parked.set(sessionId, list);
    this.begin(sessionId, waitingUntil, providerId);
    this.#syncInboxIdsFromParks(sessionId);
    this.persist();
    return row;
  }
  /**
   * Bind (or refresh) the live inbox mirror id on an existing soft park.
   * @param sessionId - session that owns the park.
   * @param parkId - {@link ParkedMessage.id}.
   * @param inboxMessageId - id currently held in `agent.inbox.nextTurn`.
   * @returns true when the park row was updated.
   */
  bindInboxMessageId(sessionId, parkId, inboxMessageId) {
    if (inboxMessageId.length === 0) return false;
    const list = this.#parked.get(sessionId);
    if (list === void 0) return false;
    const row = list.find((item) => item.id === parkId);
    if (row === void 0) return false;
    if (row.inboxMessageId === inboxMessageId) {
      this.#syncInboxIdsFromParks(sessionId);
      return true;
    }
    row.inboxMessageId = inboxMessageId;
    this.#syncInboxIdsFromParks(sessionId);
    this.persist();
    return true;
  }
  /**
   * Remove the soft park mirrored to a live inbox id (QueueDock delete).
   * @param sessionId - session that owns the park.
   * @param inboxMessageId - live inbox message id.
   * @returns the removed row, or undefined when no mirror matched.
   */
  takeByInboxMessageId(sessionId, inboxMessageId) {
    const list = this.#parked.get(sessionId);
    if (list === void 0) return void 0;
    const index = list.findIndex((row2) => row2.inboxMessageId === inboxMessageId);
    if (index < 0) return void 0;
    const [row] = list.splice(index, 1);
    if (list.length === 0) {
      this.#parked.delete(sessionId);
    } else {
      this.#parked.set(sessionId, list);
    }
    const existing = this.#bySession.get(sessionId);
    if (existing !== void 0) {
      const fromParks = this.mirroredInboxIds(sessionId);
      const next = [.../* @__PURE__ */ new Set([
        ...fromParks,
        ...(existing.inboxMessageIds ?? []).filter((id) => id !== inboxMessageId)
      ])];
      this.#bySession.set(sessionId, {
        ...existing,
        inboxMessageIds: next.length > 0 ? next : void 0
      });
    }
    this.persist();
    return row;
  }
  /**
   * Inbox mirror ids derived from soft parks.
   * @param sessionId - session to inspect.
   */
  mirroredInboxIds(sessionId) {
    const fromParks = (this.#parked.get(sessionId) ?? []).map((row) => row.inboxMessageId).filter((id) => typeof id === "string" && id.length > 0);
    return [...new Set(fromParks)];
  }
  /**
   * @param sessionId - session whose turn is deferred.
   * @param waitingUntil - next allowed instant.
   * @param providerId - provider whose schedule deferred this session.
   */
  begin(sessionId, waitingUntil, providerId) {
    const existing = this.#bySession.get(sessionId);
    this.#bySession.set(sessionId, {
      waitingUntil: waitingUntil.toISOString(),
      startedAt: existing?.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      providerId: providerId ?? existing?.providerId,
      sendConflict: existing?.sendConflict,
      inboxMessageIds: existing?.inboxMessageIds
    });
    this.persist();
  }
  /**
   * Refresh the advertised next-run instant while the same wait continues.
   * @param sessionId - session still waiting.
   * @param waitingUntil - updated next allowed instant.
   * @param providerId - optional provider refresh when known.
   */
  refresh(sessionId, waitingUntil, providerId) {
    const existing = this.#bySession.get(sessionId);
    if (existing === void 0) {
      this.begin(sessionId, waitingUntil, providerId);
      return;
    }
    this.#bySession.set(sessionId, {
      ...existing,
      waitingUntil: waitingUntil.toISOString(),
      providerId: providerId ?? existing.providerId
    });
    this.persist();
  }
  /**
   * Mark that a new user send arrived while a resume park is held.
   * @param sessionId - session with the conflict.
   */
  setSendConflict(sessionId, conflict) {
    const existing = this.#bySession.get(sessionId);
    if (existing === void 0) {
      if (!conflict) return;
      this.#bySession.set(sessionId, {
        waitingUntil: (/* @__PURE__ */ new Date()).toISOString(),
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        sendConflict: true
      });
      this.persist();
      return;
    }
    this.#bySession.set(sessionId, { ...existing, sendConflict: conflict || void 0 });
    this.persist();
  }
  /**
   * Replace tracked inbox park ids for a session (idle send without wake).
   * Always unions with park {@link ParkedMessage.inboxMessageId} mirrors so a
   * memory-only sync cannot drop durable mirror ids.
   * @param sessionId - session that owns the inbox parks.
   * @param ids - message ids currently held in the agent inbox for this wait.
   */
  setInboxMessageIds(sessionId, ids) {
    const fromParks = this.mirroredInboxIds(sessionId);
    const unique = [.../* @__PURE__ */ new Set([
      ...fromParks,
      ...ids.filter((id) => id.length > 0)
    ])];
    const existing = this.#bySession.get(sessionId);
    if (existing === void 0) {
      if (unique.length === 0) return;
      this.#bySession.set(sessionId, {
        waitingUntil: (/* @__PURE__ */ new Date()).toISOString(),
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        inboxMessageIds: unique
      });
      this.persist();
      return;
    }
    const prev = existing.inboxMessageIds ?? [];
    if (prev.length === unique.length && prev.every((id, i) => id === unique[i])) return;
    this.#bySession.set(sessionId, {
      ...existing,
      inboxMessageIds: unique.length > 0 ? unique : void 0
    });
    this.persist();
  }
  /**
   * @param sessionId - session to inspect.
   * @returns durable inbox park ids (park mirrors ∪ wait-level legacy ids).
   */
  inboxMessageIds(sessionId) {
    const fromParks = this.mirroredInboxIds(sessionId);
    const fromWait = this.#bySession.get(sessionId)?.inboxMessageIds ?? [];
    return [.../* @__PURE__ */ new Set([...fromParks, ...fromWait])];
  }
  /**
   * @param sessionId - session to inspect.
   * @returns true when Client should show the resume-vs-new-send dialog.
   */
  hasSendConflict(sessionId) {
    return this.#bySession.get(sessionId)?.sendConflict === true;
  }
  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one resume park is held.
   */
  hasResume(sessionId) {
    return (this.#parked.get(sessionId) ?? []).some((row) => row.kind === "resume");
  }
  /**
   * Drop resume parks only; leave user parks and clear sendConflict.
   * @param sessionId - session to edit.
   * @returns number of resume rows removed.
   */
  discardResume(sessionId) {
    const list = this.#parked.get(sessionId);
    if (list === void 0) {
      this.setSendConflict(sessionId, false);
      return 0;
    }
    const kept = list.filter((row) => row.kind !== "resume");
    const removed = list.length - kept.length;
    if (kept.length === 0) {
      this.#parked.delete(sessionId);
    } else {
      this.#parked.set(sessionId, kept);
    }
    this.#syncInboxIdsFromParks(sessionId);
    this.setSendConflict(sessionId, false);
    this.persist();
    return removed;
  }
  /**
   * Take every parked message and clear the wait marker.
   * @param sessionId - session to drain.
   * @returns parked rows in admission order.
   */
  takeAll(sessionId) {
    const list = this.#parked.get(sessionId) ?? [];
    this.#parked.delete(sessionId);
    this.#bySession.delete(sessionId);
    this.persist();
    return list;
  }
  /**
   * Remove one parked row; clears the wait marker when the queue empties.
   * @param sessionId - session that owns the row.
   * @param itemId - {@link ParkedMessage.id}.
   * @returns the removed row, or undefined when missing.
   */
  takeOne(sessionId, itemId) {
    const list = this.#parked.get(sessionId);
    if (list === void 0) return void 0;
    const index = list.findIndex((row2) => row2.id === itemId);
    if (index < 0) return void 0;
    const [row] = list.splice(index, 1);
    if (list.length === 0) {
      this.#parked.delete(sessionId);
      this.#bySession.delete(sessionId);
    } else {
      this.#parked.set(sessionId, list);
      this.#syncInboxIdsFromParks(sessionId);
    }
    this.persist();
    return row;
  }
  /**
   * @param sessionId - session whose wait ended without draining (legacy clear).
   */
  clear(sessionId) {
    const had = this.#parked.has(sessionId) || this.#bySession.has(sessionId);
    this.#parked.delete(sessionId);
    this.#bySession.delete(sessionId);
    if (had) this.persist();
  }
  /**
   * @param sessionId - session to inspect.
   * @returns live wait marker, or undefined when not waiting.
   */
  get(sessionId) {
    return this.#bySession.get(sessionId);
  }
  /**
   * @param sessionId - session to inspect.
   * @returns parked rows (copies of metadata; message refs unchanged).
   */
  list(sessionId) {
    return this.#parked.get(sessionId) ?? [];
  }
  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one message is parked.
   */
  hasParked(sessionId) {
    return (this.#parked.get(sessionId)?.length ?? 0) > 0;
  }
  /**
   * @returns session ids that currently have a wait marker or soft park.
   */
  waitingSessionIds() {
    return [.../* @__PURE__ */ new Set([...this.#bySession.keys(), ...this.#parked.keys()])];
  }
  /**
   * @param providerId - provider to match.
   * @returns how many sessions are waiting under that provider.
   */
  countWaitingForProvider(providerId) {
    let count = 0;
    for (const id of this.waitingSessionIds()) {
      const wait = this.#bySession.get(id);
      if (wait?.providerId === providerId) count += 1;
    }
    return count;
  }
  load() {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      const sessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
      let maxSeq = 0;
      for (const [sessionId, value] of Object.entries(sessions)) {
        const row = normalizeSessionWait(value);
        if (row === void 0) continue;
        const { parks, ...wait } = row;
        this.#bySession.set(sessionId, wait);
        if (parks.length > 0) {
          this.#parked.set(sessionId, parks);
          for (const park of parks) {
            maxSeq = Math.max(maxSeq, parseParkIdSeq(park.id));
          }
          this.#syncInboxIdsFromParks(sessionId);
        }
      }
      this.#seq = maxSeq;
    } catch {
    }
  }
  /**
   * Align wait-level inboxMessageIds with park mirror ids when mirrors exist.
   * Never wipes legacy id-only lists merely because soft parks lack mirrors.
   */
  #syncInboxIdsFromParks(sessionId) {
    const existing = this.#bySession.get(sessionId);
    if (existing === void 0) return;
    const fromParks = this.mirroredInboxIds(sessionId);
    if (fromParks.length === 0) return;
    const prev = existing.inboxMessageIds ?? [];
    const next = [.../* @__PURE__ */ new Set([...fromParks, ...prev])];
    if (next.length === prev.length && next.every((id, i) => id === prev[i])) return;
    this.#bySession.set(sessionId, {
      ...existing,
      inboxMessageIds: next
    });
  }
  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const sessions = {};
    const ids = /* @__PURE__ */ new Set([...this.#bySession.keys(), ...this.#parked.keys()]);
    for (const sessionId of ids) {
      const wait = this.#bySession.get(sessionId);
      const parks = this.#parked.get(sessionId) ?? [];
      const persistedParks = [];
      for (const park of parks) {
        const message = jsonClone(park.message);
        if (message === void 0) {
          this.#onPersistSkip?.({
            sessionId,
            parkId: park.id,
            reason: "non-json"
          });
          continue;
        }
        persistedParks.push({
          id: park.id,
          kind: park.kind,
          parkedAt: park.parkedAt,
          textPreview: park.textPreview,
          message,
          ...park.inboxMessageId !== void 0 && park.inboxMessageId.length > 0 ? { inboxMessageId: park.inboxMessageId } : {}
        });
      }
      if (wait === void 0 && persistedParks.length === 0) continue;
      const inboxFromParks = persistedParks.map((row) => row.inboxMessageId).filter((id) => typeof id === "string" && id.length > 0);
      const inboxIds = [.../* @__PURE__ */ new Set([
        ...inboxFromParks,
        ...wait?.inboxMessageIds ?? []
      ])];
      sessions[sessionId] = {
        waitingUntil: wait?.waitingUntil ?? (/* @__PURE__ */ new Date()).toISOString(),
        startedAt: wait?.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
        ...wait?.providerId !== void 0 ? { providerId: wait.providerId } : {},
        ...wait?.sendConflict === true ? { sendConflict: true } : {},
        ...inboxIds.length > 0 ? { inboxMessageIds: inboxIds } : {},
        parks: persistedParks
      };
    }
    const body = { version: STORE_VERSION, sessions };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
};
function normalizeSessionWait(raw) {
  if (raw === null || typeof raw !== "object") return void 0;
  const waitingUntil = typeof raw.waitingUntil === "string" ? raw.waitingUntil : void 0;
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : void 0;
  if (waitingUntil === void 0 || startedAt === void 0) return void 0;
  const parksRaw = Array.isArray(raw.parks) ? raw.parks : [];
  const parks = [];
  for (const item of parksRaw) {
    if (item === null || typeof item !== "object") continue;
    const row = item;
    if (typeof row.id !== "string" || !isParkKind(row.kind)) continue;
    if (typeof row.parkedAt !== "string" || typeof row.textPreview !== "string") continue;
    parks.push({
      id: row.id,
      kind: row.kind,
      parkedAt: row.parkedAt,
      textPreview: row.textPreview,
      message: row.message,
      ...typeof row.inboxMessageId === "string" && row.inboxMessageId.length > 0 ? { inboxMessageId: row.inboxMessageId } : {}
    });
  }
  const inboxRaw = Array.isArray(raw.inboxMessageIds) ? raw.inboxMessageIds : void 0;
  const inboxMessageIds = inboxRaw?.filter((id) => typeof id === "string" && id.length > 0);
  return {
    waitingUntil,
    startedAt,
    providerId: typeof raw.providerId === "string" ? raw.providerId : void 0,
    sendConflict: raw.sendConflict === true ? true : void 0,
    inboxMessageIds: inboxMessageIds !== void 0 && inboxMessageIds.length > 0 ? inboxMessageIds : void 0,
    parks
  };
}
export {
  WaitStateStore
};
