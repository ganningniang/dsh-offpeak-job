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
function isPeak(date = /* @__PURE__ */ new Date()) {
  return isDeepSeekPeak(date);
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
function nextOffpeakInstant(from = /* @__PURE__ */ new Date()) {
  return nextAllowedInstant(from, { scheduleKind: "deepseek" });
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
async function sleepUntil(until, signal) {
  while (Date.now() < until.getTime()) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    }
    const wait = Math.min(15e3, Math.max(0, until.getTime() - Date.now()));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, wait);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
export {
  DEEPSEEK_PEAK_WINDOWS,
  DEFAULT_CUSTOM_IDLE,
  PEAK_WINDOWS_NOTE,
  ZERO_DURATION_IDLE_WINDOW,
  assertFiniteDurationIdleWindows,
  daysMatch,
  defaultKindForProvider,
  formatWindow,
  isDeepSeekPeak,
  isPeak,
  mergeIdleWindows,
  nextAllowedInstant,
  nextDeferInstant,
  nextOffpeakInstant,
  normalizeWindowDays,
  resolveIdleWindows,
  resolveIdleWindowsForSave,
  sanitizeIdleWindows,
  shanghaiParts,
  shouldDefer,
  sleepUntil
};
