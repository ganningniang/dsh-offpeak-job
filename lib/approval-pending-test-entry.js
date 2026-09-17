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
export {
  ApprovalPendingTracker
};
