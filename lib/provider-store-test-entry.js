// src/provider-store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// src/types.ts
var DEEPSEEK_OFFICIAL_PROVIDER = "deepseek-official";

// src/approval-policy.ts
var DEFAULT_OFFPEAK_APPROVAL_POLICY = "reject";
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
}
function resolveOffpeakApprovalPolicy(value) {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY;
}

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
var DAY_MINS = 24 * 60;
var DAYS_ORDER = ["all", "weekdays", "weekends"];
function defaultKindForProvider(providerId) {
  return providerId === DEEPSEEK_OFFICIAL_PROVIDER ? "deepseek" : "none";
}
function normalizeWindowDays(days) {
  return days === "weekdays" || days === "weekends" ? days : "all";
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

// src/provider-store.ts
var STORE_VERSION = 1;
function defaultStorePath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "offpeak-job", "providers.json");
}
function normalize(providerId, raw) {
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
  constructor(path = defaultStorePath()) {
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
    if (!existsSync(this.path)) {
      this.providers = {};
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      const providers = raw.providers && typeof raw.providers === "object" ? raw.providers : {};
      this.providers = {};
      for (const [id, value] of Object.entries(providers)) {
        this.providers[id] = normalize(id, value);
      }
    } catch {
      this.providers = {};
    }
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const body = { version: STORE_VERSION, providers: this.providers };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
};
export {
  ProviderScheduleStore
};
