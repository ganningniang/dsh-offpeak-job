// src/approval-policy.ts
var DEFAULT_OFFPEAK_APPROVAL_POLICY = "reject";
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
}
function resolveOffpeakApprovalPolicy(value) {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY;
}

// src/types.ts
var DEEPSEEK_OFFICIAL_PROVIDER = "deepseek-official";

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
function sessionIdOf(agent) {
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
    const sessionId = sessionIdOf(agent);
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
export {
  decideOffpeakApproval,
  installOffpeakApproval
};
