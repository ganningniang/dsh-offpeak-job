// src/store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// src/approval-policy.ts
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
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
export {
  SessionConfigStore
};
