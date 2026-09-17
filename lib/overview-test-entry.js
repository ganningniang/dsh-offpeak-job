// src/approval-policy.ts
var DEFAULT_OFFPEAK_APPROVAL_POLICY = "reject";
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
}
function resolveOffpeakApprovalPolicy(value) {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY;
}

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
export {
  buildOverview
};
