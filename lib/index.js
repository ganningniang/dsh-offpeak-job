// src/store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// src/approval-policy.ts
var DEFAULT_OFFPEAK_APPROVAL_POLICY = "reject";
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
}
function resolveOffpeakApprovalPolicy(value) {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY;
}

// src/store.ts
var STORE_VERSION = 4;
function defaultStorePath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  const next = join(home, "offpeak-job", "sessions.json");
  const legacy = join(home, "offpeak-queue", "sessions.json");
  if (!existsSync(next) && existsSync(legacy)) {
    mkdirSync(dirname(next), { recursive: true });
    try {
      renameSync(legacy, next);
    } catch {
    }
  }
  return next;
}
function normalize(raw) {
  const approvalPolicy = parseOffpeakApprovalPolicy(raw.approvalPolicy);
  return {
    enabled: raw.enabled === true,
    ...approvalPolicy !== void 0 ? { approvalPolicy } : {},
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (/* @__PURE__ */ new Date(0)).toISOString()
  };
}
var SessionConfigStore = class {
  sessions = {};
  listeners = /* @__PURE__ */ new Set();
  path;
  constructor(path = defaultStorePath()) {
    this.path = path;
    this.load();
  }
  /**
   * Subscribe to session toggle writes.
   * @param listener - called after each successful {@link set}.
   * @returns disposer.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * @returns every session id that has a stored off-peak config row.
   */
  ids() {
    return Object.keys(this.sessions);
  }
  get(sessionId) {
    const existing = this.sessions[sessionId];
    if (existing) {
      return {
        ...existing,
        ...existing.approvalPolicy !== void 0 ? { approvalPolicy: existing.approvalPolicy } : {}
      };
    }
    return { enabled: false, updatedAt: (/* @__PURE__ */ new Date(0)).toISOString() };
  }
  /**
   * True when this session has never stored an approvalPolicy (eligible to inherit).
   * @param sessionId - session to inspect.
   */
  lacksApprovalPolicy(sessionId) {
    return this.sessions[sessionId]?.approvalPolicy === void 0;
  }
  set(sessionId, patch) {
    const prev = this.get(sessionId);
    const nextPolicy = patch.approvalPolicy !== void 0 ? parseOffpeakApprovalPolicy(patch.approvalPolicy) : prev.approvalPolicy;
    const next = {
      enabled: patch.enabled ?? prev.enabled,
      ...nextPolicy !== void 0 ? { approvalPolicy: nextPolicy } : {},
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.sessions[sessionId] = next;
    this.save();
    const snapshot = this.get(sessionId);
    for (const listener of this.listeners) listener(sessionId, snapshot, prev);
    return snapshot;
  }
  /**
   * Drop a session row entirely (orphan discard / cleanup).
   * @param sessionId - session to remove.
   * @returns true when a row was present.
   */
  remove(sessionId) {
    if (this.sessions[sessionId] === void 0) return false;
    const prev = this.get(sessionId);
    delete this.sessions[sessionId];
    this.save();
    const cleared = {
      enabled: false,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    for (const listener of this.listeners) listener(sessionId, cleared, prev);
    return true;
  }
  load() {
    if (!existsSync(this.path)) {
      this.sessions = {};
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      const sessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
      this.sessions = {};
      for (const [id, value] of Object.entries(sessions)) {
        this.sessions[id] = normalize(value);
      }
    } catch {
      this.sessions = {};
    }
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const body = { version: STORE_VERSION, sessions: this.sessions };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
};

// src/provider-store.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2, existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";

// src/types.ts
var DEEPSEEK_OFFICIAL_PROVIDER = "deepseek-official";

// src/offpeak.ts
var DEEPSEEK_PEAK_WINDOWS = [
  { startMin: 9 * 60, endMin: 12 * 60 },
  { startMin: 14 * 60, endMin: 18 * 60 }
];
var DEFAULT_CUSTOM_IDLE = {
  startMin: 18 * 60,
  endMin: 9 * 60,
  days: "all"
};
var PEAK_WINDOWS_NOTE = "DeepSeek peak (Asia/Shanghai): Mon\u2013Fri 09:00\u201312:00 and 14:00\u201318:00; else idle (~\xBD price).";
var DAY_MINS = 24 * 60;
var DAYS_ORDER = ["all", "weekdays", "weekends"];
function defaultKindForProvider(providerId) {
  return providerId === DEEPSEEK_OFFICIAL_PROVIDER ? "deepseek" : "none";
}
function shanghaiParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    weekday: weekdayMap[map.weekday ?? "Sun"] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}
function normalizeWindowDays(days) {
  return days === "weekdays" || days === "weekends" ? days : "all";
}
function daysMatch(days, weekday) {
  const tag = normalizeWindowDays(days);
  if (tag === "all") return true;
  if (tag === "weekdays") return weekday >= 1 && weekday <= 5;
  return weekday === 0 || weekday === 6;
}
function inWindow(mins, w) {
  if (w.startMin === w.endMin) return true;
  if (w.startMin < w.endMin) return mins >= w.startMin && mins < w.endMin;
  return mins >= w.startMin || mins < w.endMin;
}
function mergeIdleWindows(windows) {
  if (windows.length === 0) return [];
  const byDays = /* @__PURE__ */ new Map();
  for (const w of windows) {
    const days = normalizeWindowDays(w.days);
    const list = byDays.get(days) ?? [];
    list.push({ startMin: w.startMin, endMin: w.endMin, days });
    byDays.set(days, list);
  }
  const mergedByDays = /* @__PURE__ */ new Map();
  for (const days of DAYS_ORDER) {
    const group = byDays.get(days);
    if (group === void 0) continue;
    mergedByDays.set(days, mergeSameDayWindows(group));
  }
  const allCovered = coverageFromWindows(mergedByDays.get("all") ?? []);
  const out = [];
  for (const range of mergedByDays.get("all") ?? []) {
    out.push({ ...range, days: "all" });
  }
  for (const days of ["weekdays", "weekends"]) {
    const ranges = mergedByDays.get(days);
    if (ranges === void 0) continue;
    for (const range of subtractCoverage(ranges, allCovered)) {
      out.push({ ...range, days });
    }
  }
  return out;
}
function paintWindow(covered, w) {
  if (w.startMin === w.endMin) {
    covered.fill(true);
    return;
  }
  if (w.startMin < w.endMin) {
    for (let m = w.startMin; m < w.endMin; m++) covered[m] = true;
    return;
  }
  for (let m = w.startMin; m < DAY_MINS; m++) covered[m] = true;
  for (let m = 0; m < w.endMin; m++) covered[m] = true;
}
function coverageFromWindows(windows) {
  const covered = new Array(DAY_MINS).fill(false);
  for (const w of windows) paintWindow(covered, w);
  return covered;
}
function subtractCoverage(ranges, subtract) {
  const kept = new Array(DAY_MINS).fill(false);
  for (const w of ranges) paintWindow(kept, w);
  for (let m = 0; m < DAY_MINS; m++) {
    if (subtract[m]) kept[m] = false;
  }
  return runsFromCoverage(kept);
}
function runsFromCoverage(covered) {
  if (covered.every(Boolean)) return [{ startMin: 0, endMin: 0 }];
  const runs = [];
  let i = 0;
  while (i < DAY_MINS) {
    if (!covered[i]) {
      i++;
      continue;
    }
    const startMin = i;
    while (i < DAY_MINS && covered[i]) i++;
    runs.push({ startMin, endMin: i });
  }
  if (runs.length === 0) return [];
  if (runs.length >= 2 && runs[0].startMin === 0 && runs[runs.length - 1].endMin === DAY_MINS) {
    const morning = runs.shift();
    const evening = runs.pop();
    runs.push({ startMin: evening.startMin, endMin: morning.endMin });
  }
  return runs.map((run) => run.endMin === DAY_MINS ? { startMin: run.startMin, endMin: 0 } : { startMin: run.startMin, endMin: run.endMin });
}
function mergeSameDayWindows(windows) {
  if (windows.length === 1) return [{ startMin: windows[0].startMin, endMin: windows[0].endMin }];
  return runsFromCoverage(coverageFromWindows(windows));
}
function sanitizeIdleWindows(windows) {
  if (windows === void 0 || windows.length === 0) return [{ ...DEFAULT_CUSTOM_IDLE }];
  const cleaned = windows.filter(
    (w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.startMin >= 0 && w.startMin < DAY_MINS && w.endMin >= 0 && w.endMin < DAY_MINS
  ).map((w) => ({
    startMin: w.startMin,
    endMin: w.endMin,
    days: normalizeWindowDays(w.days)
  }));
  return cleaned.length === 0 ? [{ ...DEFAULT_CUSTOM_IDLE }] : cleaned;
}
var ZERO_DURATION_IDLE_WINDOW = "Idle window start and end must differ (same clock time is not a valid range)";
function assertFiniteDurationIdleWindows(windows) {
  for (const w of windows) {
    if (w.startMin === w.endMin) throw new Error(ZERO_DURATION_IDLE_WINDOW);
  }
}
function resolveIdleWindows(windows) {
  return mergeIdleWindows(sanitizeIdleWindows(windows));
}
function resolveIdleWindowsForSave(windows) {
  const cleaned = sanitizeIdleWindows(windows);
  assertFiniteDurationIdleWindows(cleaned);
  return mergeIdleWindows(cleaned);
}
function isDeepSeekPeak(date = /* @__PURE__ */ new Date()) {
  const p = shanghaiParts(date);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const mins = p.hour * 60 + p.minute;
  return DEEPSEEK_PEAK_WINDOWS.some((w) => mins >= w.startMin && mins < w.endMin);
}
function shouldDefer(date, policy) {
  if (policy.scheduleKind === "none") return false;
  if (policy.scheduleKind !== "custom") return isDeepSeekPeak(date);
  const windows = resolveIdleWindows(policy.idleWindows);
  const p = shanghaiParts(date);
  const mins = p.hour * 60 + p.minute;
  return !windows.some((w) => daysMatch(w.days, p.weekday) && inWindow(mins, w));
}
function nextAllowedInstant(from = /* @__PURE__ */ new Date(), policy = { scheduleKind: "deepseek" }) {
  if (!shouldDefer(from, policy)) return from;
  let cursor = new Date(Math.floor(from.getTime() / 6e4) * 6e4);
  for (let step = 0; step < 8 * 24 * 60; step++) {
    if (!shouldDefer(cursor, policy)) return cursor;
    cursor = new Date(cursor.getTime() + 6e4);
  }
  return cursor;
}
function nextDeferInstant(from = /* @__PURE__ */ new Date(), policy = { scheduleKind: "deepseek" }) {
  if (policy.scheduleKind === "none") return null;
  if (shouldDefer(from, policy)) return from;
  let cursor = new Date(Math.floor(from.getTime() / 6e4) * 6e4);
  for (let step = 0; step < 8 * 24 * 60; step++) {
    cursor = new Date(cursor.getTime() + 6e4);
    if (shouldDefer(cursor, policy)) return cursor;
  }
  return null;
}
function formatWindow(w) {
  const fmt = (m) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  const range = `${fmt(w.startMin)}\u2013${fmt(w.endMin)}`;
  const days = normalizeWindowDays(w.days);
  if (days === "all") return range;
  return `${days} ${range}`;
}

// src/provider-store.ts
var STORE_VERSION2 = 1;
function defaultStorePath2() {
  const home = process.env.DSH_HOME?.trim() || join2(homedir2(), ".dsh");
  return join2(home, "offpeak-job", "providers.json");
}
function normalize2(providerId, raw) {
  const kind = raw.scheduleKind === "custom" || raw.scheduleKind === "deepseek" || raw.scheduleKind === "none" ? raw.scheduleKind : defaultKindForProvider(providerId);
  const windowEndPolicy = raw.windowEndPolicy === "pause" ? "pause" : "continue";
  const defaultApprovalPolicy = resolveOffpeakApprovalPolicy(raw.defaultApprovalPolicy);
  return {
    scheduleKind: kind,
    idleWindows: kind === "custom" ? sanitizeIdleWindows(raw.idleWindows) : void 0,
    // Legacy rows omit the field; keep the composer chip unless explicitly turned off.
    chipVisible: raw.chipVisible !== false,
    windowEndPolicy,
    defaultApprovalPolicy,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (/* @__PURE__ */ new Date(0)).toISOString()
  };
}
var ProviderScheduleStore = class {
  providers = {};
  path;
  constructor(path = defaultStorePath2()) {
    this.path = path;
    this.load();
  }
  get(providerId) {
    const existing = this.providers[providerId];
    if (existing) {
      return {
        ...existing,
        idleWindows: existing.idleWindows?.map((w) => ({ ...w }))
      };
    }
    return {
      scheduleKind: defaultKindForProvider(providerId),
      chipVisible: true,
      windowEndPolicy: "continue",
      defaultApprovalPolicy: "reject",
      updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
    };
  }
  /**
   * @returns provider ids that have an explicit row in providers.json.
   */
  ids() {
    return Object.keys(this.providers);
  }
  /**
   * True when at least one provider still has peak/off-peak enabled
   * (`chipVisible` and not `scheduleKind: none`). Empty store uses DeepSeek default.
   */
  anyOffpeakEnabled() {
    this.reload();
    const ids = this.ids();
    const active = (id) => {
      const config = this.get(id);
      return config.chipVisible !== false && config.scheduleKind !== "none";
    };
    if (ids.length === 0) {
      return active(DEEPSEEK_OFFICIAL_PROVIDER);
    }
    return ids.some(active);
  }
  /** Re-read `$DSH_HOME/.../providers.json` so session UI sees settings Apply writes. */
  reload() {
    this.load();
  }
  /** Effective deferral policy for a provider route (overlapping windows merged). */
  policy(providerId) {
    const config = this.get(providerId);
    return {
      providerId,
      scheduleKind: config.scheduleKind,
      idleWindows: config.scheduleKind === "custom" ? resolveIdleWindows(config.idleWindows) : void 0
    };
  }
  set(providerId, patch) {
    const prev = this.get(providerId);
    const scheduleKind = patch.scheduleKind ?? prev.scheduleKind;
    let idleWindows = prev.idleWindows;
    if (patch.idleWindows !== void 0) {
      idleWindows = resolveIdleWindowsForSave(patch.idleWindows);
    } else if (scheduleKind === "custom" && (idleWindows === void 0 || idleWindows.length === 0)) {
      idleWindows = [{ ...DEFAULT_CUSTOM_IDLE }];
    }
    if (scheduleKind !== "custom") idleWindows = void 0;
    const next = {
      scheduleKind,
      idleWindows,
      chipVisible: patch.chipVisible ?? prev.chipVisible,
      windowEndPolicy: patch.windowEndPolicy ?? prev.windowEndPolicy,
      defaultApprovalPolicy: patch.defaultApprovalPolicy !== void 0 ? resolveOffpeakApprovalPolicy(patch.defaultApprovalPolicy) : prev.defaultApprovalPolicy,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.providers[providerId] = next;
    this.save();
    return this.get(providerId);
  }
  load() {
    if (!existsSync2(this.path)) {
      this.providers = {};
      return;
    }
    try {
      const raw = JSON.parse(readFileSync2(this.path, "utf8"));
      const providers = raw.providers && typeof raw.providers === "object" ? raw.providers : {};
      this.providers = {};
      for (const [id, value] of Object.entries(providers)) {
        this.providers[id] = normalize2(id, value);
      }
    } catch {
      this.providers = {};
    }
  }
  save() {
    mkdirSync2(dirname2(this.path), { recursive: true });
    const body = { version: STORE_VERSION2, providers: this.providers };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync2(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync2(tmp, this.path);
  }
};

// src/wait-state.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, renameSync as renameSync3, writeFileSync as writeFileSync3, existsSync as existsSync3 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { homedir as homedir3 } from "node:os";
var STORE_VERSION3 = 1;
function defaultStorePath3() {
  const home = process.env.DSH_HOME?.trim() || join3(homedir3(), ".dsh");
  return join3(home, "offpeak-job", "waits.json");
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
    this.path = path ?? defaultStorePath3();
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
    if (!existsSync3(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync3(this.path, "utf8"));
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
    mkdirSync3(dirname3(this.path), { recursive: true });
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
    const body = { version: STORE_VERSION3, sessions };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync3(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync3(tmp, this.path);
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

// src/approval-pending.ts
var ApprovalPendingTracker = class {
  #pending = /* @__PURE__ */ new Map();
  /**
   * @param sessionId - session to inspect.
   * @returns true when at least one approval is unanswered.
   */
  hasPending(sessionId) {
    return (this.#pending.get(sessionId)?.size ?? 0) > 0;
  }
  /**
   * @returns session ids that currently have pending approvals.
   */
  pendingSessionIds() {
    return [...this.#pending.entries()].filter(([, ids]) => ids.size > 0).map(([id]) => id);
  }
  /**
   * Seed / update from a session event fold.
   * @param sessionId - session that owns the event.
   * @param event - session log event.
   */
  onEvent(sessionId, event) {
    if (event.type === "turn/end") {
      this.#pending.delete(sessionId);
      return;
    }
    const id = event.data?.id;
    if (typeof id !== "string" || id.length === 0) return;
    if (event.type === "approval/asked") {
      let set = this.#pending.get(sessionId);
      if (set === void 0) {
        set = /* @__PURE__ */ new Set();
        this.#pending.set(sessionId, set);
      }
      set.add(id);
      return;
    }
    if (event.type === "approval/decided") {
      const set = this.#pending.get(sessionId);
      if (set === void 0) return;
      set.delete(id);
      if (set.size === 0) this.#pending.delete(sessionId);
    }
  }
  /**
   * Replace pending ids for a session from a full log fold.
   * @param sessionId - session to seed.
   * @param events - session snapshot events.
   */
  seedFromEvents(sessionId, events) {
    this.#pending.delete(sessionId);
    for (const event of events) this.onEvent(sessionId, event);
  }
  /**
   * Subscribe to Host session events and seed live sessions.
   * @param ctx - Cordis context with optional sessions + on.
   * @returns disposer.
   */
  install(ctx, logger) {
    if (typeof ctx?.on !== "function") {
      logger?.warn?.("[dsh-offpeak-job] ctx.on unavailable \u2014 skipping approval pending tracker");
      return () => {
      };
    }
    const seedSession = (session) => {
      const id = typeof session?.id === "string" ? session.id : void 0;
      if (id === void 0) return;
      try {
        const events = typeof session.snapshotEvents === "function" ? session.snapshotEvents() : [];
        this.seedFromEvents(id, events);
      } catch {
      }
    };
    try {
      const list = ctx.sessions?.list?.();
      if (Array.isArray(list)) {
        for (const session of list) seedSession(session);
      }
    } catch {
    }
    const offs = [];
    const onCreated = ctx.on("session/created", (session) => {
      seedSession(session);
    }, { global: true });
    if (typeof onCreated === "function") offs.push(onCreated);
    const onEvent = ctx.on("session/event", (session, event) => {
      const id = typeof session?.id === "string" ? session.id : void 0;
      if (id === void 0) return;
      this.onEvent(id, event);
    }, { global: true });
    if (typeof onEvent === "function") offs.push(onEvent);
    const onDisposed = ctx.on("session/disposed", (session) => {
      const id = typeof session?.id === "string" ? session.id : void 0;
      if (id !== void 0) this.#pending.delete(id);
    }, { global: true });
    if (typeof onDisposed === "function") offs.push(onDisposed);
    return () => {
      for (const off of offs) off();
      this.#pending.clear();
    };
  }
};

// src/overview.ts
function buildOverview(sessions, providers, waits, hooks = {}) {
  providers.reload();
  const entryVisible = providers.anyOffpeakEnabled();
  const { agentOf, hasApprovalPending } = hooks;
  if (!entryVisible) {
    return {
      entryVisible: false,
      badgeCount: 0,
      sessions: [],
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const ids = /* @__PURE__ */ new Set([
    ...sessions.ids(),
    ...waits.waitingSessionIds()
  ]);
  const rows = [];
  for (const sessionId of ids) {
    const config = sessions.get(sessionId);
    if (!config.enabled) continue;
    const wait = waits.get(sessionId);
    const parks = waits.list(sessionId);
    const parkedUser = parks.filter((row) => row.kind === "user").length;
    const parkedResume = parks.filter((row) => row.kind === "resume").length;
    const parkedNotice = parks.filter((row) => row.kind === "notice").length;
    const hasWaitMarker = wait !== void 0;
    const inboxIds = waits.inboxMessageIds(sessionId).length;
    const agentLookup = typeof agentOf === "function";
    const agent = agentLookup ? agentOf(sessionId) : void 0;
    const providerId = wait?.providerId ?? agent?.providerId ?? null;
    const approvalPolicy = resolveOffpeakApprovalPolicy(
      providerId !== null ? providers.get(providerId).defaultApprovalPolicy : void 0
    );
    const sendConflict = wait?.sendConflict === true;
    const previewRow = parks.find((row) => row.kind === "resume") ?? parks.find((row) => row.kind === "user") ?? parks[0];
    const textPreview = previewRow?.textPreview ?? "";
    const hasQueue = hasWaitMarker || parks.length > 0 || inboxIds > 0;
    const windowWait = parkedUser > 0 || parkedResume > 0 || hasWaitMarker || inboxIds > 0;
    const orphan = agentLookup && agent === void 0 && hasQueue;
    const approvalPending = hasApprovalPending?.(sessionId) === true;
    let status = "idle";
    if (orphan) status = "orphan";
    else if (sendConflict) status = "conflict";
    else if (approvalPending) status = "approval";
    else if (parkedResume > 0) status = "resume";
    else if (parkedUser > 0 || inboxIds > 0 || hasWaitMarker) status = "waiting";
    else if (agent?.status === "running") status = "running";
    else status = "idle";
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
      agentStatus: typeof agent?.status === "string" ? agent.status : null,
      orphan,
      approvalPending,
      windowWait
    });
  }
  rows.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.sessionId.localeCompare(b.sessionId));
  const badgeCount = rows.filter((row) => row.status === "waiting" || row.status === "resume" || row.status === "conflict" || row.status === "orphan" || row.status === "approval").length;
  return {
    entryVisible: true,
    badgeCount,
    sessions: rows,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function statusRank(status) {
  switch (status) {
    case "orphan":
      return 0;
    case "conflict":
      return 1;
    case "approval":
      return 2;
    case "resume":
      return 3;
    case "waiting":
      return 4;
    case "running":
      return 5;
    case "idle":
      return 6;
    default:
      return 9;
  }
}

// src/api.ts
function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
function sessionIdFromPath(pathname) {
  const m = /^\/api\/offpeak-job\/session\/([^/]+)/.exec(pathname);
  if (!m?.[1]) return void 0;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
function isCancelWaitPath(pathname) {
  return /\/cancel-wait\/?$/.test(pathname);
}
function isReleasePath(pathname) {
  return /\/release\/?$/.test(pathname);
}
function isResolveSendPath(pathname) {
  return /\/resolve-send\/?$/.test(pathname);
}
function providerIdFromPath(pathname) {
  const m = /^\/api\/offpeak-job\/provider\/([^/]+)\/?$/.exec(pathname);
  if (!m?.[1]) return void 0;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
function providerView(store, providerId, waitingCount = 0) {
  store.reload();
  const config = store.get(providerId);
  const policy = store.policy(providerId);
  const scheduleActive = config.scheduleKind !== "none";
  const chipVisible = config.chipVisible !== false;
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
    deferredNow: shouldDefer(/* @__PURE__ */ new Date(), policy),
    nextOffpeak: nextAllowedInstant(/* @__PURE__ */ new Date(), policy).toISOString(),
    peakWindowsNote: PEAK_WINDOWS_NOTE,
    defaultPeakWindows: DEEPSEEK_PEAK_WINDOWS,
    defaultCustomIdle: DEFAULT_CUSTOM_IDLE,
    summary: config.scheduleKind === "deepseek" ? PEAK_WINDOWS_NOTE : config.scheduleKind === "none" ? "none" : (config.idleWindows ?? []).map(formatWindow).join(", ")
  };
}
function sessionView(sessions, providers, waits, sessionId, providerId) {
  const config = sessions.get(sessionId);
  const provider = providerView(providers, providerId);
  const policy = providers.policy(providerId);
  const deferredNow = config.enabled && provider.chipVisible && provider.scheduleActive && shouldDefer(/* @__PURE__ */ new Date(), policy);
  const wait = waits.get(sessionId);
  const parked = waits.list(sessionId).filter((row) => row.kind !== "notice").map((row) => ({
    id: row.id,
    textPreview: row.textPreview,
    parkedAt: row.parkedAt,
    kind: row.kind,
    /** True when mirrored into live inbox for QueueDock (WaitDock should not repeat the preview). */
    inboxMirrored: typeof row.inboxMessageId === "string" && row.inboxMessageId.length > 0
  }));
  const resumePending = waits.hasResume(sessionId);
  const approvalPolicy = resolveOffpeakApprovalPolicy(
    provider.config.defaultApprovalPolicy
  );
  return {
    sessionId,
    providerId,
    config: {
      enabled: config.enabled,
      updatedAt: config.updatedAt
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
    nextOffpeak: wait?.waitingUntil ?? nextAllowedInstant(/* @__PURE__ */ new Date(), policy).toISOString(),
    peakWindowsNote: PEAK_WINDOWS_NOTE,
    defaultCustomIdle: DEFAULT_CUSTOM_IDLE
  };
}
function registerApi(webServer, sessions, providers, waits, hooks = {
  cancelWait: () => false,
  releaseNow: () => false,
  discardResume: () => false,
  keepResumeConflict: () => {
  },
  releaseForProvider: () => 0,
  reevaluateForProvider: () => 0,
  countWaitingForProvider: () => 0
}) {
  const disposers = [];
  disposers.push(webServer.register({
    kind: "exact",
    path: "/api/offpeak-job/overview",
    handler: (_req, res) => {
      try {
        json(res, 200, buildOverview(sessions, providers, waits, {
          agentOf: hooks.agentOf,
          hasApprovalPending: hooks.hasApprovalPending
        }));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));
  disposers.push(webServer.register({
    kind: "exact",
    path: "/api/offpeak-job/health",
    handler: (_req, res) => {
      json(res, 200, {
        ok: true,
        plugin: "dsh-offpeak-job",
        peakWindowsNote: PEAK_WINDOWS_NOTE,
        defaultPeakWindows: DEEPSEEK_PEAK_WINDOWS,
        defaultCustomIdle: DEFAULT_CUSTOM_IDLE,
        isPeakNow: isDeepSeekPeak(),
        nextOffpeak: nextAllowedInstant().toISOString()
      });
    }
  }));
  disposers.push(webServer.register({
    kind: "prefix",
    path: "/api/offpeak-job/provider",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://dsh.internal");
        const providerId = providerIdFromPath(url.pathname);
        if (!providerId) {
          json(res, 404, { error: "missing provider id" });
          return;
        }
        if (req.method === "GET") {
          json(res, 200, providerView(
            providers,
            providerId,
            hooks.countWaitingForProvider(providerId)
          ));
          return;
        }
        if (req.method === "PUT" || req.method === "PATCH") {
          const body = await readJsonBody(req);
          const prev = providers.get(providerId);
          const kind = body.scheduleKind;
          const nextChip = typeof body.chipVisible === "boolean" ? body.chipVisible : prev.chipVisible;
          providers.set(providerId, {
            scheduleKind: kind === "custom" || kind === "deepseek" || kind === "none" ? kind : void 0,
            idleWindows: Array.isArray(body.idleWindows) ? body.idleWindows : void 0,
            ...typeof body.chipVisible === "boolean" ? { chipVisible: body.chipVisible } : {},
            ...body.windowEndPolicy === "pause" || body.windowEndPolicy === "continue" ? { windowEndPolicy: body.windowEndPolicy } : {},
            ...(() => {
              const policy = parseOffpeakApprovalPolicy(body.defaultApprovalPolicy);
              return policy !== void 0 ? { defaultApprovalPolicy: policy } : {};
            })()
          });
          let released = 0;
          if (prev.chipVisible !== false && nextChip === false) {
            released = hooks.releaseForProvider(providerId);
          } else if (nextChip !== false) {
            released = hooks.reevaluateForProvider(providerId);
          }
          json(res, 200, {
            ...providerView(
              providers,
              providerId,
              hooks.countWaitingForProvider(providerId)
            ),
            released
          });
          return;
        }
        json(res, 405, { error: "method not allowed" });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));
  disposers.push(webServer.register({
    kind: "prefix",
    path: "/api/offpeak-job/session",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://dsh.internal");
        const sessionId = sessionIdFromPath(url.pathname);
        if (!sessionId) {
          json(res, 404, { error: "missing session id" });
          return;
        }
        if (isResolveSendPath(url.pathname)) {
          if (req.method === "POST") {
            const body = await readJsonBody(req);
            const action = body.action === "discard-resume" ? "discard-resume" : "keep-resume";
            if (action === "discard-resume") {
              hooks.discardResume(sessionId);
            } else {
              hooks.keepResumeConflict(sessionId);
            }
            const providerParam2 = url.searchParams.get("provider")?.trim() || DEEPSEEK_OFFICIAL_PROVIDER;
            json(res, 200, {
              ok: true,
              action,
              ...sessionView(sessions, providers, waits, sessionId, providerParam2)
            });
            return;
          }
          json(res, 405, { error: "method not allowed" });
          return;
        }
        if (isCancelWaitPath(url.pathname)) {
          if (req.method === "POST" || req.method === "DELETE") {
            const agentMissing = typeof hooks.agentOf === "function" && hooks.agentOf(sessionId) === void 0;
            const hadQueue = waits.get(sessionId) !== void 0 || waits.hasParked(sessionId) || waits.inboxMessageIds(sessionId).length > 0;
            const cancelled = hooks.cancelWait(sessionId);
            let removedSession = false;
            if (agentMissing && hadQueue) {
              removedSession = sessions.remove(sessionId);
            }
            json(res, 200, {
              ok: true,
              cancelled,
              removedSession,
              waitingUntil: waits.get(sessionId)?.waitingUntil ?? null,
              parked: []
            });
            return;
          }
          json(res, 405, { error: "method not allowed" });
          return;
        }
        if (isReleasePath(url.pathname)) {
          if (req.method === "POST") {
            const released = hooks.releaseNow(sessionId);
            const providerParam2 = url.searchParams.get("provider")?.trim() || DEEPSEEK_OFFICIAL_PROVIDER;
            json(res, 200, {
              ok: true,
              released,
              ...sessionView(sessions, providers, waits, sessionId, providerParam2)
            });
            return;
          }
          json(res, 405, { error: "method not allowed" });
          return;
        }
        const providerParam = url.searchParams.get("provider")?.trim();
        if (req.method === "GET") {
          const providerId = providerParam || DEEPSEEK_OFFICIAL_PROVIDER;
          json(res, 200, sessionView(sessions, providers, waits, sessionId, providerId));
          return;
        }
        if (req.method === "PUT" || req.method === "PATCH") {
          const body = await readJsonBody(req);
          const providerId = typeof body.provider === "string" && body.provider.trim() || providerParam || DEEPSEEK_OFFICIAL_PROVIDER;
          if (typeof body.enabled === "boolean") {
            sessions.set(sessionId, { enabled: body.enabled });
          }
          json(res, 200, sessionView(sessions, providers, waits, sessionId, providerId));
          return;
        }
        json(res, 405, { error: "method not allowed" });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// src/resolve-provider.ts
function resolveSessionProvider(agent, ctx) {
  try {
    const api = ctx?.apiSession;
    const live = api?.selectionFor?.(agent)?.current;
    if (typeof live?.provider === "string" && live.provider.length > 0) return live.provider;
  } catch {
  }
  try {
    const header = agent?.session?.requestHeader?.();
    const provider = header?.config?.provider;
    if (typeof provider === "string" && provider.length > 0) return provider;
  } catch {
  }
  try {
    const events = agent?.session?.events;
    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev?.type === "model/selection" && typeof ev.data?.provider === "string") {
          return ev.data.provider;
        }
        if (ev?.type === "request/header" && typeof ev.data?.header?.config?.provider === "string") {
          return ev.data.header.config.provider;
        }
      }
    }
  } catch {
  }
  try {
    const sel = ctx?.agentDefaultModel?.currentSelection?.();
    if (typeof sel?.provider === "string" && sel.provider.length > 0) return sel.provider;
  } catch {
  }
  return DEEPSEEK_OFFICIAL_PROVIDER;
}

// src/resume-message.ts
import { randomUUID } from "node:crypto";
var RESUME_PROMPT_TEXT = "The previous turn was paused because the off-peak (idle) window ended. Please continue the unfinished task from where it left off.";
function createResumeUserMessage() {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text: RESUME_PROMPT_TEXT }],
    source: {
      kind: "plugin",
      plugin: "dsh-offpeak-job",
      form: "notice",
      summary: "Off-peak window ended; resume"
    }
  };
}

// src/job-notice.ts
function isJobCompletionNotice(message) {
  const source = message?.source;
  if (source === null || typeof source !== "object") return false;
  const tagged = source;
  return tagged.kind === "plugin" && tagged.plugin === "tool-jobs" && tagged.form === "notice";
}

// src/park.ts
var WRAPPED = Symbol.for("dsh-offpeak-job.park-wrapped");
var RELEASING = Symbol.for("dsh-offpeak-job.park-releasing");
var INBOX_WRAPPED = Symbol.for("dsh-offpeak-job.inbox-wrapped");
var WINDOW_END_CANCEL = { kind: "hook", reason: "offpeak-window-end" };
function sessionIdOf(agent) {
  const id = agent?.session?.id ?? agent?.id;
  return typeof id === "string" && id.length > 0 ? id : void 0;
}
function retirePrompt(ctx, agent, message) {
  const source = message?.source;
  if (source?.kind !== "user" || typeof source.rpcId !== "string") return;
  try {
    ctx?.fileUploads?.retirePrompt?.(agent, source.rpcId);
  } catch {
  }
}
function messageIdOf(message) {
  const id = message?.id;
  return typeof id === "string" && id.length > 0 ? id : void 0;
}
function installOffpeakPark(ctx, sessions, providers, waits, logger) {
  const timers = /* @__PURE__ */ new Map();
  const windowEndTimers = /* @__PURE__ */ new Map();
  const resumeAborting = /* @__PURE__ */ new Set();
  const manualPauseBypass = /* @__PURE__ */ new Set();
  const inboxParks = /* @__PURE__ */ new Map();
  const originals = /* @__PURE__ */ new WeakMap();
  const shouldPark = (agent) => {
    const sessionId = sessionIdOf(agent);
    if (sessionId === void 0) return false;
    if (agent[RELEASING] === true) return false;
    const config = sessions.get(sessionId);
    if (!config.enabled) return false;
    const providerId = resolveSessionProvider(agent, ctx);
    providers.reload();
    if (providers.get(providerId).chipVisible === false) return false;
    const policy = providers.policy(providerId);
    return shouldDefer(/* @__PURE__ */ new Date(), policy);
  };
  const clearTimer = (sessionId) => {
    const timer = timers.get(sessionId);
    if (timer !== void 0) {
      clearTimeout(timer);
      timers.delete(sessionId);
    }
  };
  const clearWindowEndTimer = (sessionId) => {
    const timer = windowEndTimers.get(sessionId);
    if (timer !== void 0) {
      clearTimeout(timer);
      windowEndTimers.delete(sessionId);
    }
  };
  const pausePolicyActive = (sessionId, agent) => {
    if (!sessions.get(sessionId).enabled) return false;
    const providerId = resolveSessionProvider(agent, ctx);
    providers.reload();
    const config = providers.get(providerId);
    if (config.chipVisible === false) return false;
    if (config.scheduleKind === "none") return false;
    return config.windowEndPolicy === "pause";
  };
  const armWindowEndWatch = (sessionId, agent) => {
    clearWindowEndTimer(sessionId);
    if (agent?.status !== "running") return;
    if (!pausePolicyActive(sessionId, agent)) return;
    const providerId = resolveSessionProvider(agent, ctx);
    const policy = providers.policy(providerId);
    const now = /* @__PURE__ */ new Date();
    const until = nextDeferInstant(now, policy);
    if (until === null) return;
    const fire = () => {
      windowEndTimers.delete(sessionId);
      const live = ctx.agents?.get?.(sessionId);
      if (live === void 0) return;
      if (!pausePolicyActive(sessionId, live)) return;
      if (live.status !== "running") return;
      if (manualPauseBypass.has(sessionId)) return;
      const livePolicy = providers.policy(resolveSessionProvider(live, ctx));
      if (!shouldDefer(/* @__PURE__ */ new Date(), livePolicy)) {
        armWindowEndWatch(sessionId, live);
        return;
      }
      logger?.info?.(
        `[dsh-offpeak-job] session ${sessionId}: pausing running turn at idle-window end`
      );
      resumeAborting.add(sessionId);
      try {
        live.cancel(WINDOW_END_CANCEL, { keepInbox: true });
      } catch (error) {
        resumeAborting.delete(sessionId);
        logger?.warn?.(
          `[dsh-offpeak-job] session ${sessionId}: window-end cancel failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };
    if (shouldDefer(now, policy) || until.getTime() <= Date.now()) {
      fire();
      return;
    }
    const delay = Math.min(Math.max(0, until.getTime() - Date.now()) + 25, 6e4);
    windowEndTimers.set(sessionId, setTimeout(() => {
      const live = ctx.agents?.get?.(sessionId);
      if (live === void 0) {
        windowEndTimers.delete(sessionId);
        return;
      }
      if (!pausePolicyActive(sessionId, live) || live.status !== "running") {
        windowEndTimers.delete(sessionId);
        return;
      }
      const livePolicy = providers.policy(resolveSessionProvider(live, ctx));
      const next = nextDeferInstant(/* @__PURE__ */ new Date(), livePolicy);
      if (next !== null && next.getTime() > Date.now() + 500) {
        armWindowEndWatch(sessionId, live);
        return;
      }
      fire();
    }, delay));
  };
  const parkResumeAfterCancel = (sessionId, agent) => {
    resumeAborting.delete(sessionId);
    clearWindowEndTimer(sessionId);
    if (!sessions.get(sessionId).enabled) return;
    if (waits.hasResume(sessionId)) {
      scheduleRelease(sessionId, agent);
      return;
    }
    const providerId = resolveSessionProvider(agent, ctx);
    const until = nextAllowedInstant(/* @__PURE__ */ new Date(), providers.policy(providerId));
    waits.enqueue(sessionId, createResumeUserMessage(), until, providerId, "resume");
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId}: parked resume until ${until.toISOString()}`
    );
    scheduleRelease(sessionId, agent);
  };
  const syncInboxIds = (sessionId) => {
    const set = inboxParks.get(sessionId);
    waits.setInboxMessageIds(sessionId, set === void 0 ? [] : [...set]);
  };
  const noteInboxPark = (sessionId, message) => {
    const id = messageIdOf(message);
    if (id === void 0) return;
    const set = inboxParks.get(sessionId) ?? /* @__PURE__ */ new Set();
    set.add(id);
    inboxParks.set(sessionId, set);
    syncInboxIds(sessionId);
  };
  const takeInboxParks = (sessionId) => {
    const set = inboxParks.get(sessionId);
    inboxParks.delete(sessionId);
    const ids = set === void 0 ? [] : [...set];
    syncInboxIds(sessionId);
    return ids;
  };
  const clearWaitIfIdle = (sessionId) => {
    if (waits.hasParked(sessionId)) return;
    if ((inboxParks.get(sessionId)?.size ?? 0) > 0) return;
    if (waits.inboxMessageIds(sessionId).length > 0) return;
    clearTimer(sessionId);
    waits.clear(sessionId);
  };
  const forgetInboxPark = (sessionId, messageId) => {
    waits.takeByInboxMessageId(sessionId, messageId);
    const set = inboxParks.get(sessionId);
    if (set === void 0 || !set.delete(messageId)) {
      syncInboxIds(sessionId);
      clearWaitIfIdle(sessionId);
      return;
    }
    if (set.size === 0) inboxParks.delete(sessionId);
    syncInboxIds(sessionId);
    clearWaitIfIdle(sessionId);
  };
  const liveInboxIds = (agent) => {
    const live = /* @__PURE__ */ new Set();
    for (const message of agent?.inbox?.nextTurn ?? []) {
      const id = messageIdOf(message);
      if (id !== void 0) live.add(id);
    }
    return live;
  };
  const restoreInboxParks = (sessionId, agent) => {
    const pair = originals.get(agent);
    const live = liveInboxIds(agent);
    const set = inboxParks.get(sessionId) ?? /* @__PURE__ */ new Set();
    for (const park of waits.list(sessionId)) {
      if (park.inboxMessageId === void 0) continue;
      if (live.has(park.inboxMessageId)) {
        set.add(park.inboxMessageId);
        continue;
      }
      if (pair === void 0 || typeof pair.send !== "function") {
        continue;
      }
      const before = liveInboxIds(agent);
      pair.send(park.message, "next-turn", false);
      const after = liveInboxIds(agent);
      let newId = messageIdOf(park.message);
      if (newId === void 0 || !after.has(newId)) {
        for (const id of after) {
          if (!before.has(id)) {
            newId = id;
            break;
          }
        }
      }
      if (newId !== void 0) {
        waits.bindInboxMessageId(sessionId, park.id, newId);
        set.add(newId);
        live.add(newId);
        logger?.info?.(
          `[dsh-offpeak-job] session ${sessionId}: re-mirrored park ${park.id} as inbox ${newId}`
        );
      }
    }
    for (const id of waits.inboxMessageIds(sessionId)) {
      if (set.has(id)) continue;
      if (live.has(id)) set.add(id);
    }
    if (set.size === 0) inboxParks.delete(sessionId);
    else inboxParks.set(sessionId, set);
    syncInboxIds(sessionId);
    clearWaitIfIdle(sessionId);
  };
  const reconcileInboxParks = (sessionId, agent) => {
    const live = liveInboxIds(agent);
    let set = inboxParks.get(sessionId);
    if (set === void 0 && waits.inboxMessageIds(sessionId).length > 0) {
      set = new Set(waits.inboxMessageIds(sessionId));
      inboxParks.set(sessionId, set);
    }
    if (set === void 0) {
      clearWaitIfIdle(sessionId);
      return;
    }
    const mirrored = new Set(waits.mirroredInboxIds(sessionId));
    for (const id of [...set]) {
      if (live.has(id)) continue;
      if (mirrored.has(id)) {
        continue;
      }
      set.delete(id);
    }
    if (set.size === 0) inboxParks.delete(sessionId);
    syncInboxIds(sessionId);
    clearWaitIfIdle(sessionId);
  };
  const deliver = (agent, message) => {
    const pair = originals.get(agent);
    if (pair === void 0) {
      agent.followup(message);
      return;
    }
    pair.followup(message);
  };
  const release = (sessionId, options) => {
    clearTimer(sessionId);
    const agents = ctx.agents;
    const agent = agents?.get?.(sessionId);
    if (agent === void 0) {
      const soft2 = waits.list(sessionId).length;
      const inbox = inboxParks.get(sessionId)?.size ?? waits.inboxMessageIds(sessionId).length;
      if (soft2 + inbox > 0) {
        logger?.warn?.(
          `[dsh-offpeak-job] session ${sessionId}: release deferred \u2014 agent gone, ${soft2 + inbox} park(s) retained on disk`
        );
      }
      return 0;
    }
    const manual = options?.manual === true;
    if (manual) manualPauseBypass.add(sessionId);
    waits.setSendConflict(sessionId, false);
    const soft = waits.takeAll(sessionId);
    const mirroredInboxIds = new Set(
      soft.map((row) => row.inboxMessageId).filter((id) => typeof id === "string" && id.length > 0)
    );
    const inboxIds = new Set(takeInboxParks(sessionId));
    const pair = originals.get(agent);
    const fromInbox = [];
    if (agent.inbox?.nextTurn) {
      for (const message of [...agent.inbox.nextTurn]) {
        const id = messageIdOf(message);
        if (id === void 0) continue;
        if (mirroredInboxIds.has(id)) {
          try {
            agent.inbox.remove(id);
          } catch {
          }
          continue;
        }
        if (inboxIds.size > 0 && !inboxIds.has(id)) continue;
        if (inboxIds.size === 0) continue;
        try {
          agent.inbox.remove(id);
        } catch {
        }
        fromInbox.push(message);
      }
    }
    const orderedMessages = [
      ...soft.filter((row) => row.kind === "resume").map((row) => row.message),
      ...soft.filter((row) => row.kind === "user").map((row) => row.message),
      ...fromInbox,
      ...soft.filter((row) => row.kind === "notice").map((row) => row.message)
    ];
    agent[RELEASING] = true;
    let count = 0;
    try {
      for (const message of orderedMessages) {
        logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: releasing parked message`);
        deliver(agent, message);
        count += 1;
      }
    } finally {
      agent[RELEASING] = false;
    }
    if (manual && count === 0) manualPauseBypass.delete(sessionId);
    void pair;
    return count;
  };
  const discard = (sessionId) => {
    clearTimer(sessionId);
    clearWindowEndTimer(sessionId);
    resumeAborting.delete(sessionId);
    manualPauseBypass.delete(sessionId);
    waits.setSendConflict(sessionId, false);
    const soft = waits.takeAll(sessionId);
    const inboxIds = takeInboxParks(sessionId);
    const agents = ctx.agents;
    const agent = agents?.get?.(sessionId);
    let count = 0;
    if (agent !== void 0) {
      for (const id of inboxIds) {
        const message = agent.inbox?.nextTurn?.find?.((row) => messageIdOf(row) === id);
        try {
          agent.inbox?.remove?.(id);
          count += 1;
        } catch {
        }
        if (message !== void 0) retirePrompt(ctx, agent, message);
      }
    } else {
      count += inboxIds.length;
    }
    for (const item of soft) {
      if (agent !== void 0) retirePrompt(ctx, agent, item.message);
      count += 1;
    }
    if (count > 0) {
      logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: discarded ${count} parked message(s)`);
    }
    return count;
  };
  const discardResume = (sessionId) => {
    const removed = waits.discardResume(sessionId);
    const agent = ctx.agents?.get?.(sessionId);
    if (agent !== void 0) {
      clearWaitIfIdle(sessionId);
      scheduleRelease(sessionId, agent);
    } else if (!waits.hasParked(sessionId) && (inboxParks.get(sessionId)?.size ?? 0) === 0 && waits.inboxMessageIds(sessionId).length === 0) {
      waits.clear(sessionId);
    }
    if (removed > 0) {
      logger?.info?.(`[dsh-offpeak-job] session ${sessionId}: discarded ${removed} resume park(s)`);
    }
    return removed;
  };
  const keepResumeConflict = (sessionId) => {
    waits.setSendConflict(sessionId, false);
    const agent = ctx.agents?.get?.(sessionId);
    if (agent !== void 0) scheduleRelease(sessionId, agent);
  };
  const scheduleRelease = (sessionId, agent) => {
    if (waits.list(sessionId).some((row) => row.inboxMessageId !== void 0)) {
      restoreInboxParks(sessionId, agent);
    } else {
      reconcileInboxParks(sessionId, agent);
    }
    clearTimer(sessionId);
    const hasSoft = waits.hasParked(sessionId);
    const hasInbox = (inboxParks.get(sessionId)?.size ?? 0) > 0 || waits.inboxMessageIds(sessionId).length > 0;
    if (!hasSoft && !hasInbox) {
      waits.clear(sessionId);
      return;
    }
    if (waits.hasSendConflict(sessionId)) {
      const providerId2 = resolveSessionProvider(agent, ctx);
      const until2 = nextAllowedInstant(/* @__PURE__ */ new Date(), providers.policy(providerId2));
      waits.refresh(sessionId, until2, providerId2);
      return;
    }
    const providerId = resolveSessionProvider(agent, ctx);
    const policy = providers.policy(providerId);
    const now = /* @__PURE__ */ new Date();
    if (!sessions.get(sessionId).enabled || !shouldDefer(now, policy)) {
      if (agent.status === "running" && hasSoft && !hasInbox) {
        waits.refresh(sessionId, nextAllowedInstant(now, policy));
        timers.set(sessionId, setTimeout(() => {
          timers.delete(sessionId);
          const live = ctx.agents?.get?.(sessionId);
          if (live === void 0) return;
          scheduleRelease(sessionId, live);
        }, 1e3));
        return;
      }
      release(sessionId);
      return;
    }
    const until = nextAllowedInstant(now, policy);
    waits.refresh(sessionId, until);
    const delay = Math.min(Math.max(0, until.getTime() - Date.now()) + 25, 6e4);
    timers.set(sessionId, setTimeout(() => {
      timers.delete(sessionId);
      const live = ctx.agents?.get?.(sessionId);
      if (live === void 0) return;
      scheduleRelease(sessionId, live);
    }, delay));
  };
  const resumeWaitingSession = (sessionId, agent) => {
    restoreInboxParks(sessionId, agent);
    const hasSoft = waits.hasParked(sessionId);
    const hasInbox = (inboxParks.get(sessionId)?.size ?? 0) > 0 || waits.inboxMessageIds(sessionId).length > 0;
    const hasWait = waits.get(sessionId) !== void 0;
    if (!hasSoft && !hasInbox && !hasWait) return;
    scheduleRelease(sessionId, agent);
    if (agent.status === "running") armWindowEndWatch(sessionId, agent);
  };
  const parkMessage = (agent, message, via) => {
    const sessionId = sessionIdOf(agent);
    if (sessionId === void 0) return false;
    const providerId = resolveSessionProvider(agent, ctx);
    const pair = originals.get(agent);
    const hadResume = waits.hasResume(sessionId);
    const until = nextAllowedInstant(/* @__PURE__ */ new Date(), providers.policy(providerId));
    const notice = isJobCompletionNotice(message);
    if (!notice && agent.status === "idle" && pair !== void 0 && typeof pair.send === "function") {
      const row2 = waits.enqueue(sessionId, message, until, providerId, "user");
      pair.send(message, "next-turn", false);
      const inboxId = messageIdOf(message);
      if (inboxId !== void 0) {
        waits.bindInboxMessageId(sessionId, row2.id, inboxId);
        noteInboxPark(sessionId, message);
      }
      if (hadResume) waits.setSendConflict(sessionId, true);
      logger?.info?.(
        `[dsh-offpeak-job] session ${sessionId} provider ${providerId}: soft+inbox-parked ${via}${hadResume ? " behind resume" : ""} ${row2.id} until ${until.toISOString()}`
      );
      scheduleRelease(sessionId, agent);
      return true;
    }
    const kind = notice ? "notice" : "user";
    const row = waits.enqueue(sessionId, message, until, providerId, kind);
    if (hadResume && !notice) waits.setSendConflict(sessionId, true);
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId} provider ${providerId}: soft-parked ${via}${notice ? " job notice" : hadResume ? " behind resume" : ""} ${row.id} until ${until.toISOString()}`
    );
    scheduleRelease(sessionId, agent);
    return true;
  };
  const wrap = (agent) => {
    if (agent == null || typeof agent !== "object") return;
    if (agent[WRAPPED] === true) return;
    if (typeof agent.followup !== "function" || typeof agent.steer !== "function") return;
    if (typeof agent.send !== "function") return;
    agent[WRAPPED] = true;
    const followup = agent.followup.bind(agent);
    const steer = agent.steer.bind(agent);
    const send = agent.send.bind(agent);
    originals.set(agent, { followup, steer, send });
    agent.followup = (message) => {
      const sessionId2 = sessionIdOf(agent);
      if (sessionId2 !== void 0 && waits.hasResume(sessionId2) && agent[RELEASING] !== true) {
        parkMessage(agent, message, "followup");
        return;
      }
      if (shouldPark(agent)) {
        parkMessage(agent, message, "followup");
        return;
      }
      followup(message);
    };
    agent.steer = (message) => {
      if (agent.status === "idle" && shouldPark(agent)) {
        parkMessage(agent, message, "steer");
        return;
      }
      steer(message);
    };
    const sessionId = sessionIdOf(agent);
    const inbox = agent.inbox;
    if (sessionId !== void 0 && inbox != null && typeof inbox.remove === "function" && inbox[INBOX_WRAPPED] !== true) {
      inbox[INBOX_WRAPPED] = true;
      const remove = inbox.remove.bind(inbox);
      inbox.remove = (id) => {
        const result = remove(id);
        if (result !== false) forgetInboxPark(sessionId, id);
        return result;
      };
      if (typeof inbox.clear === "function") {
        const clear = inbox.clear.bind(inbox);
        inbox.clear = () => {
          const tracked = takeInboxParks(sessionId);
          clear();
          if (tracked.length > 0) clearWaitIfIdle(sessionId);
        };
      }
    }
  };
  for (const agent of ctx.agents?.list?.() ?? []) wrap(agent);
  for (const sessionId of waits.waitingSessionIds()) {
    const agent = ctx.agents?.get?.(sessionId);
    if (agent !== void 0) resumeWaitingSession(sessionId, agent);
  }
  const offCreated = ctx.on?.("agent/created", (payload) => {
    const agent = payload?.agent;
    wrap(agent);
    const sessionId = sessionIdOf(agent);
    if (sessionId !== void 0) resumeWaitingSession(sessionId, agent);
  });
  const offStatus = ctx.on?.("agent/status", (payload) => {
    const agent = payload?.agent;
    const sessionId = sessionIdOf(agent);
    if (sessionId === void 0) return;
    const status = payload?.status;
    if (status === "running") {
      armWindowEndWatch(sessionId, agent);
      return;
    }
    if (status !== "idle") return;
    clearWindowEndTimer(sessionId);
    manualPauseBypass.delete(sessionId);
    if (resumeAborting.has(sessionId)) {
      parkResumeAfterCancel(sessionId, agent);
      return;
    }
    if (!waits.hasParked(sessionId) && (inboxParks.get(sessionId)?.size ?? 0) === 0) return;
    scheduleRelease(sessionId, agent);
  });
  const offConfig = sessions.subscribe((sessionId, next, prev) => {
    if (prev.enabled && !next.enabled) {
      clearWindowEndTimer(sessionId);
      resumeAborting.delete(sessionId);
      release(sessionId);
      return;
    }
    if (!prev.enabled && next.enabled) {
      const agent = ctx.agents?.get?.(sessionId);
      if (agent !== void 0) {
        scheduleRelease(sessionId, agent);
        if (agent.status === "running") armWindowEndWatch(sessionId, agent);
      }
    }
  });
  const sessionsWaitingForProvider = (providerId) => {
    const ids = /* @__PURE__ */ new Set();
    for (const sessionId of waits.waitingSessionIds()) {
      const tagged = waits.get(sessionId)?.providerId;
      if (tagged === providerId) {
        ids.add(sessionId);
        continue;
      }
      if (tagged !== void 0) continue;
      const agent = ctx.agents?.get?.(sessionId);
      if (agent !== void 0 && resolveSessionProvider(agent, ctx) === providerId) {
        ids.add(sessionId);
      }
    }
    for (const sessionId of inboxParks.keys()) {
      if (ids.has(sessionId)) continue;
      const tagged = waits.get(sessionId)?.providerId;
      if (tagged === providerId) {
        ids.add(sessionId);
        continue;
      }
      const agent = ctx.agents?.get?.(sessionId);
      if (agent !== void 0 && resolveSessionProvider(agent, ctx) === providerId) {
        ids.add(sessionId);
      }
    }
    return [...ids];
  };
  const countWaitingForProvider = (providerId) => sessionsWaitingForProvider(providerId).length;
  const releaseForProvider = (providerId) => {
    let count = 0;
    for (const sessionId of sessionsWaitingForProvider(providerId)) {
      count += release(sessionId);
    }
    if (count > 0) {
      logger?.info?.(
        `[dsh-offpeak-job] provider ${providerId}: released ${count} parked message(s) after peak feature off`
      );
    }
    return count;
  };
  const reevaluateForProvider = (providerId) => {
    providers.reload();
    const policy = providers.policy(providerId);
    const chipOn = providers.get(providerId).chipVisible !== false;
    const now = /* @__PURE__ */ new Date();
    let count = 0;
    for (const sessionId of sessionsWaitingForProvider(providerId)) {
      const agent = ctx.agents?.get?.(sessionId);
      const mayRun = !chipOn || !sessions.get(sessionId).enabled || !shouldDefer(now, policy);
      if (mayRun) {
        count += release(sessionId);
        continue;
      }
      if (agent !== void 0) {
        scheduleRelease(sessionId, agent);
      } else {
        waits.refresh(sessionId, nextAllowedInstant(now, policy), providerId);
      }
    }
    for (const agent of ctx.agents?.list?.() ?? []) {
      const sessionId = sessionIdOf(agent);
      if (sessionId === void 0) continue;
      if (resolveSessionProvider(agent, ctx) !== providerId) continue;
      if (agent.status === "running") armWindowEndWatch(sessionId, agent);
      else clearWindowEndTimer(sessionId);
    }
    if (count > 0) {
      logger?.info?.(
        `[dsh-offpeak-job] provider ${providerId}: released ${count} parked message(s) after schedule change`
      );
    }
    return count;
  };
  return {
    dispose: () => {
      for (const sessionId of [...timers.keys()]) clearTimer(sessionId);
      for (const sessionId of [...windowEndTimers.keys()]) clearWindowEndTimer(sessionId);
      resumeAborting.clear();
      manualPauseBypass.clear();
      if (typeof offCreated === "function") offCreated();
      if (typeof offStatus === "function") offStatus();
      offConfig();
    },
    release,
    discard,
    discardResume,
    keepResumeConflict,
    releaseForProvider,
    reevaluateForProvider,
    countWaitingForProvider
  };
}

// src/approval.ts
function decideOffpeakApproval(enabled, policy) {
  if (!enabled) return "delegate";
  switch (policy) {
    case "reject":
      return "rejected";
    case "allow":
      return "allowed-once";
    case "wait":
      return "delegate";
    default:
      return "delegate";
  }
}
function sessionIdOf2(agent) {
  const id = agent?.session?.id ?? agent?.id;
  return typeof id === "string" && id.length > 0 ? id : void 0;
}
function installOffpeakApproval(ctx, sessions, providers, logger) {
  if (typeof ctx?.on !== "function") {
    logger?.warn?.("[dsh-offpeak-job] ctx.on unavailable \u2014 skipping approval answerer");
    return () => {
    };
  }
  const off = ctx.on("approval/request", function(request, next) {
    const agent = request?.agent;
    const sessionId = sessionIdOf2(agent);
    if (sessionId === void 0) return next();
    const config = sessions.get(sessionId);
    if (!config.enabled) return next();
    const providerId = resolveSessionProvider(agent, ctx);
    providers.reload();
    const provider = providers.get(providerId);
    if (provider.chipVisible === false) return next();
    if (providers.policy(providerId).scheduleKind === "none") return next();
    const policy = resolveOffpeakApprovalPolicy(provider.defaultApprovalPolicy);
    const decision = decideOffpeakApproval(true, policy);
    if (decision === "delegate") return next();
    const tool = typeof request.toolName === "string" ? request.toolName : "?";
    logger?.info?.(
      `[dsh-offpeak-job] session ${sessionId}: auto-${decision === "rejected" ? "reject" : "allow"} approval for ${tool}`
    );
    return decision;
  }, { prepend: true });
  return typeof off === "function" ? off : () => {
  };
}

// src/index.ts
var PLUGIN_VERSION = false ? "dev" : "0.3.0";
var name = "dsh-offpeak-job";
var inject = ["webServer", "agents"];
function apply(ctx) {
  const webServer = ctx.webServer;
  const logger = ctx.logger;
  const sessions = new SessionConfigStore();
  const providers = new ProviderScheduleStore();
  const waits = new WaitStateStore(void 0, (detail) => {
    logger?.warn?.(
      `[dsh-offpeak-job] skip non-JSON park ${detail.parkId} for session ${detail.sessionId}`
    );
  });
  const approvalPending = new ApprovalPendingTracker();
  if (!webServer) {
    logger?.warn?.("[dsh-offpeak-job] ctx.webServer unavailable \u2014 skipping Host routes");
    return;
  }
  const park = installOffpeakPark(ctx, sessions, providers, waits, logger);
  const disposeApproval = installOffpeakApproval(ctx, sessions, providers, logger);
  const disposePending = approvalPending.install(ctx, logger);
  ctx.effect(() => registerApi(webServer, sessions, providers, waits, {
    cancelWait: (sessionId) => park.discard(sessionId) > 0,
    releaseNow: (sessionId) => park.release(sessionId, { manual: true }) > 0,
    discardResume: (sessionId) => park.discardResume(sessionId) > 0,
    keepResumeConflict: (sessionId) => {
      park.keepResumeConflict(sessionId);
    },
    releaseForProvider: (providerId) => park.releaseForProvider(providerId),
    reevaluateForProvider: (providerId) => park.reevaluateForProvider(providerId),
    countWaitingForProvider: (providerId) => park.countWaitingForProvider(providerId),
    agentOf: (sessionId) => {
      const agent = ctx.agents?.get?.(sessionId);
      if (agent === void 0) return void 0;
      return {
        status: typeof agent.status === "string" ? agent.status : void 0,
        providerId: resolveSessionProvider(agent, ctx)
      };
    },
    hasApprovalPending: (sessionId) => approvalPending.hasPending(sessionId)
  }), "offpeak-job: api");
  ctx.effect(() => () => park.dispose(), "offpeak-job: park");
  ctx.effect(() => disposeApproval, "offpeak-job: approval");
  ctx.effect(() => disposePending, "offpeak-job: approval-pending");
  logger?.info?.(
    `[dsh-offpeak-job] v${PLUGIN_VERSION} ready; sessions ${sessions.path}; providers ${providers.path}; waits ${waits.path}`
  );
}
export {
  apply,
  inject,
  name
};
