window.__ModuleLoader__.load({ id: 'dsh-offpeak-job', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/provider-settings.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

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
function resolveIdleWindows(windows) {
  return mergeIdleWindows(sanitizeIdleWindows(windows));
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

// src/client/config-events.ts
var listeners = /* @__PURE__ */ new Set();
function onOffpeakProviderConfigChange(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function emitOffpeakProviderConfigChange() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
    }
  }
}

// src/client/locales.ts
var zh = {
  chipImmediate: "\u7ACB\u5373\u8FD0\u884C",
  chipOffpeak: "\u8C37\u65F6\u8FD0\u884C",
  chipWaiting: "\u8C37\u65F6\u8FD0\u884C",
  chipAria: "\u8FD0\u884C\u65F6\u673A",
  chipAriaCurrent: "\u8FD0\u884C\u65F6\u673A\uFF0C\u5F53\u524D\uFF1A{name}",
  chipTitleImmediate: "\u672C\u4F1A\u8BDD\u7ACB\u5373\u8FD0\u884C\uFF0C\u4E0D\u53D7\u5CF0\u8C37\u9650\u5236",
  chipTitleOffpeak: "\u6309\u5F53\u524D\u63D0\u4F9B\u65B9\u8C37\u65F6\u7A97\u53E3\u8FD0\u884C",
  chipTitleWaiting: "\u7B49\u5F85\u8C37\u65F6\u7A97\u53E3",
  chipTitleUnavailable: "\u5F53\u524D\u63D0\u4F9B\u65B9\u672A\u914D\u7F6E\u8C37\u65F6\uFF08\u4E0D\u9650\u5236\uFF09\uFF1B\u8BF7\u5230\u300C\u8BBE\u7F6E \u2192 \u6A21\u578B\u300D\u5CF0\u8C37\u8BBE\u7F6E\u4E2D\u914D\u7F6E",
  waitDockTitle: "\u7B49\u5F85\u8C37\u65F6",
  waitDockDetail: "\u5DF2\u6536\u5230\uFF0C\u5230 {time} \u518D\u5F00\u59CB",
  waitDockEmpty: "\u6682\u65E0\u5F85\u53D1\u6D88\u606F",
  waitDockParked: "\u5F85\u53D1 \xB7 {n}",
  waitDockRunNow: "\u73B0\u5728\u5F00\u59CB",
  waitDockCancel: "\u653E\u5F03\u5F85\u53D1",
  waitDockResumeTitle: "\u8C37\u65F6\u6682\u505C",
  waitDockResumeDetail: "\u4EFB\u52A1\u5DF2\u6682\u505C\uFF0C\u5230 {time} \u81EA\u52A8\u7EE7\u7EED",
  waitDockResumeParked: "\u5F85\u7EED \xB7 {n}",
  waitDockResumePreview: "\uFF08\u7EED\u8DD1\uFF09\u4ECE\u4E2D\u65AD\u5904\u7EE7\u7EED",
  waitDockResumeRunNow: "\u73B0\u5728\u5F00\u59CB",
  waitDockResumeCancel: "\u653E\u5F03\u7EED\u8DD1",
  waitDockMixedParked: "\u5F85\u7EED {r} \xB7 \u5F85\u53D1 {u}",
  resumeConflictTitle: "\u5F53\u524D\u8FD8\u6709\u5F85\u7EED\u8DD1\u7684\u4EFB\u52A1",
  resumeConflictHint: "\u9009\u62E9\u5148\u5B8C\u6210\u5F85\u7EED\u4EFB\u52A1\uFF0C\u6216\u4E22\u5F03\u5F85\u7EED\u5E76\u4FDD\u7559\u521A\u53D1\u9001\u7684\u5185\u5BB9\u3002",
  resumeConflictKeep: "\u5148\u5B8C\u6210\u5F85\u7EED\u4EFB\u52A1",
  resumeConflictDiscard: "\u4E22\u5F03\u5F85\u7EED",
  resumeConflictClose: "\u5173\u95ED",
  windowEndTitle: "\u8C37\u65F6\u7A97\u53E3\u7ED3\u675F\u65F6",
  windowEndContinue: "\u7EE7\u7EED\u8FD0\u884C",
  windowEndContinueHint: "\u5DF2\u5F00\u59CB\u7684\u4EFB\u52A1\u4E0D\u4E2D\u65AD",
  windowEndPause: "\u8FDB\u5165\u5CF0\u65F6\u6682\u505C\uFF0C\u4E0B\u4E00\u6BB5\u8C37\u65F6\u7EE7\u7EED",
  windowEndPauseHint: "\u5230\u70B9\u505C\u4E0B\uFF0C\u4E0B\u4E00\u6BB5\u8C37\u65F6\u81EA\u52A8\u63A5\u7740\u5E72",
  windowEndNote: "\u4EC5\u300C\u8C37\u65F6\u8FD0\u884C\u300D\u7684\u4F1A\u8BDD\u751F\u6548\uFF1B\u9009\u300C\u7ACB\u5373\u8FD0\u884C\u300D\u4E0D\u53D7\u6B64\u9650\u5236\u3002",
  windowEndSwitchHint: "\u5207\u6362\u540E\u5BF9\u4ECD\u5728\u8FD0\u884C\u7684\u4EFB\u52A1\u9A6C\u4E0A\u751F\u6548\u3002\u5DF2\u7ECF\u5F00\u59CB\u6682\u505C\u7684\u4EFB\u52A1\u4E0D\u4F1A\u56E0\u6B64\u6062\u590D\u7EE7\u7EED\u8DD1\u3002",
  providerSave: "\u4FDD\u5B58",
  providerSaving: "\u4FDD\u5B58\u4E2D\u2026",
  providerSaved: "\u5DF2\u4FDD\u5B58",
  providerCancel: "\u53D6\u6D88",
  menuImmediate: "\u7ACB\u5373\u8FD0\u884C",
  menuImmediateDesc: "\u672C\u4F1A\u8BDD\u7ACB\u5373\u8FD0\u884C\uFF0C\u4E0D\u53D7\u5CF0\u8C37\u9650\u5236",
  menuOffpeak: "\u8C37\u65F6\u8FD0\u884C",
  menuOffpeakDesc: "\u4EC5\u5728\u4EE5\u4E0B\u8C37\u65F6\u7A97\u53E3\u5185\u8FD0\u884C\uFF1A{windows}\u3002\u8FDB\u5165\u5CF0\u65F6\u662F\u5426\u6682\u505C\u3001\u4EE5\u53CA\u5982\u4F55\u4FEE\u6539\u8C37\u65F6\u65F6\u6BB5\uFF0C\u8BF7\u5230\u300C\u8BBE\u7F6E \u2192 \u6A21\u578B\u300D\u8BE5\u63D0\u4F9B\u65B9\u7684\u5CF0\u8C37\u8BBE\u7F6E\u4E2D\u67E5\u770B\u6216\u8C03\u6574\u3002",
  nextAt: "\u4E0B\u6B21\u53EF\u8DD1",
  kindDeepseek: "DeepSeek \u9ED8\u8BA4",
  kindDeepseekHint: "\u5DE5\u4F5C\u65E5 9\u201312\u300114\u201318 \u4E3A\u9AD8\u5CF0\uFF0C\u5176\u4F59\u4E3A\u8C37\u65F6",
  kindCustom: "\u81EA\u5B9A\u4E49\u8C37\u65F6",
  kindNone: "\u4E0D\u9650\u5236\uFF08\u65E0\u5CF0\u8C37\uFF09",
  kindNoneHint: "\u5F00\u542F\u8C37\u65F6\u5F00\u5173\u4E5F\u4E0D\u4F1A\u7B49\u5F85",
  daysFullDay: "\u5168\u5929",
  idleFrom: "\u5F00\u59CB",
  idleTo: "\u7ED3\u675F",
  overnightHint: "\u7ED3\u675F\u65E9\u4E8E\u5F00\u59CB\u65F6\u89C6\u4E3A\u8DE8\u591C\uFF08\u5982 18:00\u201309:00\uFF09",
  windowSameTimeHint: "\u5F00\u59CB\u4E0E\u7ED3\u675F\u76F8\u540C\u65E0\u6548",
  addWindow: "\u6DFB\u52A0\u65F6\u6BB5",
  removeWindow: "\u5220\u9664",
  daysLabel: "\u9002\u7528\u65E5",
  daysAll: "\u6BCF\u5929",
  daysWeekdays: "\u5DE5\u4F5C\u65E5",
  daysWeekends: "\u5468\u672B",
  daysScopeHint: "\u5DE5\u4F5C\u65E5\u4E3A\u5468\u4E00\u81F3\u5468\u4E94\u3001\u5468\u672B\u4E3A\u5468\u516D\u65E5",
  overlapHint: "\u65F6\u6BB5\u91CD\u53E0\u5C06\u5408\u5E76\u3002",
  providerFold: "\u5CF0\u8C37\u8BBE\u7F6E",
  providerFoldHint: "\u8C37\u65F6\u7A97\u53E3\u914D\u7F6E\uFF0C\u4F1A\u8BDD\u5F00\u542F\u300C\u8C37\u65F6\u8FD0\u884C\u300D\u540E\u751F\u6548\u3002",
  chipVisible: "\u542F\u7528\u5CF0\u8C37",
  chipVisibleHint: "\u5173\u95ED\u540E\u9690\u85CF\u4F1A\u8BDD\u8FD0\u884C\u65F6\u673A\u4E0B\u62C9\u4E0E\u8C37\u65F6\u603B\u89C8\uFF08\u5168\u90E8\u63D0\u4F9B\u65B9\u90FD\u5173\u95ED\u65F6\uFF09\uFF0C\u5E76\u505C\u6B62\u8C37\u65F6\u505C\u653E",
  chipOffFlushTitle: "\u5173\u95ED\u5CF0\u8C37",
  scheduleFlushTitle: "\u4FEE\u6539\u8C37\u65F6\u65F6\u6BB5",
  chipOffFlushHint: "\u5F53\u524D\u6392\u961F\u4E2D\u7684\u4EFB\u52A1\u5C06\u7ACB\u5373\u6267\u884C",
  chipOffFlushConfirm: "\u786E\u8BA4\u4FDD\u5B58",
  chipOffFlushCancel: "\u53D6\u6D88",
  chipOffFlushClose: "\u5173\u95ED",
  loadError: "\u65E0\u6CD5\u8BFB\u53D6\u914D\u7F6E",
  saveError: "\u4FDD\u5B58\u5931\u8D25",
  approvalPolicyTitle: "\u8C37\u65F6\u8FD0\u884C\u63D0\u6743\u5BA1\u6279\u7B56\u7565",
  approvalPolicyHint: "\u5BF9\u672C\u63D0\u4F9B\u65B9\u4E0B\u6240\u6709\u300C\u8C37\u65F6\u8FD0\u884C\u300D\u4F1A\u8BDD\u5373\u65F6\u751F\u6548\uFF1B\u300C\u7ACB\u5373\u8FD0\u884C\u300D\u4E0D\u53D7\u5F71\u54CD\u3002",
  approvalReject: "\u62D2\u7EDD\u540E\u7EE7\u7EED\u8FD0\u884C",
  approvalRejectHint: "\u81EA\u52A8\u62D2\u7EDD\u63D0\u6743\uFF0C\u5F53\u524D\u4EFB\u52A1\u7EE7\u7EED\uFF08\u6A21\u578B\u53EF\u6539\u9053\uFF09",
  approvalWait: "\u9700\u624B\u52A8\u5BA1\u6279",
  approvalWaitHint: "\u5F39\u51FA\u5BA1\u6279\u9762\u677F\uFF0C\u7B49\u4EBA\u70B9\u540E\u518D\u7EE7\u7EED\u8BE5\u5DE5\u5177\u8C03\u7528",
  approvalAllow: "\u81EA\u52A8\u540C\u610F",
  approvalAllowHint: "\u65E0\u4EBA\u503C\u5B88\u65F6\u81EA\u52A8\u653E\u884C\u63D0\u6743\uFF08\u6709\u5B89\u5168\u98CE\u9669\uFF09",
  approvalAllowConfirmTitle: "\u786E\u8BA4\u542F\u7528\u81EA\u52A8\u540C\u610F\uFF1F",
  approvalAllowConfirmHint: "\u8C37\u65F6\u4EFB\u52A1\u5C06\u81EA\u52A8\u6279\u51C6\u6C99\u7BB1\u63D0\u6743\uFF0C\u53EF\u80FD\u8D85\u51FA\u300C\u4EC5\u53EF\u67E5\u770B / \u5DE5\u4F5C\u533A\u5185\u4FEE\u6539\u300D\u7684\u8BBF\u95EE\u8303\u56F4\u3002\u8BF7\u4EC5\u5728\u4FE1\u4EFB\u8BE5\u63D0\u4F9B\u65B9\u8C37\u65F6\u4EFB\u52A1\u65F6\u542F\u7528\u3002",
  approvalAllowConfirm: "\u6211\u4E86\u89E3\u98CE\u9669\u5E76\u542F\u7528",
  approvalAllowCancel: "\u53D6\u6D88",
  overviewTrigger: "\u8C37\u65F6\u603B\u89C8",
  overviewTriggerAria: "\u8C37\u65F6\u603B\u89C8",
  overviewTitle: "\u8C37\u65F6\u603B\u89C8",
  overviewClose: "\u5173\u95ED",
  overviewLoading: "\u52A0\u8F7D\u4E2D\u2026",
  overviewEmpty: "\u5F53\u524D\u6CA1\u6709\u9700\u7559\u610F\u7684\u8C37\u65F6\u4F1A\u8BDD",
  overviewLoadError: "\u65E0\u6CD5\u8BFB\u53D6\u8C37\u65F6\u603B\u89C8",
  overviewStatusWaiting: "\u7B49\u5F85\u8C37\u65F6",
  overviewStatusResume: "\u6682\u505C\u5F85\u7EED",
  overviewStatusApproval: "\u7B49\u5F85\u5BA1\u6279",
  overviewStatusRunning: "\u8FD0\u884C\u4E2D",
  overviewStatusIdle: "\u7A7A\u95F2",
  overviewStatusConflict: "\u5F85\u786E\u8BA4",
  overviewStatusOrphan: "\u4F1A\u8BDD\u4E0D\u53EF\u7528",
  overviewNextAt: "\u4E0B\u6B21\u53EF\u8FD0\u884C {time}",
  overviewParkedUser: "\u5F85\u53D1 \xB7 {n}",
  overviewParkedResume: "\u5F85\u7EED \xB7 {n}",
  overviewParkedMixed: "\u5F85\u7EED {r} \xB7 \u5F85\u53D1 {u}",
  overviewProvider: "\u63D0\u4F9B\u65B9 {id}",
  overviewFiltersAria: "\u6309\u72B6\u6001\u7B5B\u9009",
  overviewFilterActive: "\u9700\u7559\u610F",
  overviewFilterEmpty: "\u8BE5\u72B6\u6001\u4E0B\u6CA1\u6709\u4F1A\u8BDD",
  overviewOrphanHint: "\u4F1A\u8BDD\u5DF2\u4E0D\u5728\u672C\u673A\uFF0C\u53EF\u4E22\u5F03\u6392\u961F",
  overviewOpenSession: "\u6253\u5F00\u4F1A\u8BDD",
  overviewRelease: "\u73B0\u5728\u5F00\u59CB",
  overviewCancelWait: "\u653E\u5F03\u5F85\u53D1",
  overviewDiscardOrphan: "\u4E22\u5F03",
  overviewKeepResume: "\u5148\u5B8C\u6210\u5F85\u7EED",
  overviewDiscardResume: "\u4E22\u5F03\u5F85\u7EED",
  overviewActionError: "\u64CD\u4F5C\u5931\u8D25"
};
var en = {
  chipImmediate: "Run now",
  chipOffpeak: "Off-peak run",
  chipWaiting: "Off-peak run",
  chipAria: "Run timing",
  chipAriaCurrent: "Run timing, current: {name}",
  chipTitleImmediate: "This session runs immediately with no peak/off-peak wait",
  chipTitleOffpeak: "Runs only inside the current provider\u2019s idle windows",
  chipTitleWaiting: "Waiting for an idle window",
  chipTitleUnavailable: "This provider has no off-peak schedule; configure it under Settings \u2192 Models \u2192 Peak / off-peak",
  waitDockTitle: "Waiting for off-peak",
  waitDockDetail: "Queued until {time}",
  waitDockEmpty: "No parked messages",
  waitDockParked: "Parked \xB7 {n}",
  waitDockRunNow: "Start now",
  waitDockCancel: "Discard pending",
  waitDockResumeTitle: "Paused for peak hours",
  waitDockResumeDetail: "Will resume at {time}",
  waitDockResumeParked: "Resume \xB7 {n}",
  waitDockResumePreview: "(Resume) Continue from where it left off",
  waitDockResumeRunNow: "Start now",
  waitDockResumeCancel: "Discard resume",
  waitDockMixedParked: "Resume {r} \xB7 Parked {u}",
  resumeConflictTitle: "A paused task is waiting to resume",
  resumeConflictHint: "Finish the paused task first, or discard it and keep what you just sent.",
  resumeConflictKeep: "Keep resume first",
  resumeConflictDiscard: "Discard resume",
  resumeConflictClose: "Close",
  windowEndTitle: "When the off-peak window ends",
  windowEndContinue: "Keep running",
  windowEndContinueHint: "Started tasks are not interrupted",
  windowEndPause: "Pause when peak begins, resume next off-peak",
  windowEndPauseHint: "Stops at the boundary; resumes in the next idle window",
  windowEndNote: "Only applies when the session is set to Off-peak run.",
  windowEndSwitchHint: "Applies immediately to tasks still running. Tasks already being paused will not resume from this change.",
  providerSave: "Save",
  providerSaving: "Saving\u2026",
  providerSaved: "Saved",
  providerCancel: "Cancel",
  menuImmediate: "Run now",
  menuImmediateDesc: "This session runs immediately with no peak/off-peak wait",
  menuOffpeak: "Off-peak run",
  menuOffpeakDesc: "Run only inside these idle windows: {windows}. Whether to pause when peak begins, and how to edit idle windows, are under Settings \u2192 Models \u2192 Peak / off-peak for this provider.",
  nextAt: "Next run",
  kindDeepseek: "DeepSeek default",
  kindDeepseekHint: "Peak weekdays 09\u201312 & 14\u201318; otherwise idle (Asia/Shanghai)",
  kindCustom: "Custom idle windows",
  kindNone: "No restriction",
  kindNoneHint: "The session toggle will not wait",
  daysFullDay: "all day",
  idleFrom: "From",
  idleTo: "To",
  overnightHint: "If end is earlier than start, the window crosses midnight (e.g. 18:00\u201309:00)",
  windowSameTimeHint: "Start and end must differ",
  addWindow: "Add window",
  removeWindow: "Remove",
  daysLabel: "Days",
  daysAll: "Every day",
  daysWeekdays: "Weekdays",
  daysWeekends: "Weekends",
  daysScopeHint: "Weekdays are Mon\u2013Fri and weekends Sat\u2013Sun (Asia/Shanghai)",
  overlapHint: "Overlapping windows will be merged.",
  providerFold: "Peak / off-peak",
  providerFoldHint: "Idle windows for this provider when a session chooses Off-peak run. Save writes plugin config (separate from provider Apply).",
  chipVisible: "Enable off-peak",
  chipVisibleHint: "When off, hides the composer run-timing control and the Off-peak overview (once every provider is off), and stops off-peak parking",
  chipOffFlushTitle: "Turn off peak / off-peak",
  scheduleFlushTitle: "Change idle windows",
  chipOffFlushHint: "Queued tasks waiting for off-peak will run immediately",
  chipOffFlushConfirm: "Save",
  chipOffFlushCancel: "Cancel",
  chipOffFlushClose: "Close",
  loadError: "Could not load config",
  saveError: "Save failed",
  approvalPolicyTitle: "Off-peak escalation approval policy",
  approvalPolicyHint: "Applies immediately to all Off-peak run sessions on this provider; Run now is unchanged.",
  approvalReject: "Reject and continue",
  approvalRejectHint: "Auto-deny escalations; the turn continues (the model may try another approach)",
  approvalWait: "Require manual approval",
  approvalWaitHint: "Show the approval panel and wait for a human decision",
  approvalAllow: "Auto-allow",
  approvalAllowHint: "Auto-grant escalations while unattended (security risk)",
  approvalAllowConfirmTitle: "Enable auto-allow?",
  approvalAllowConfirmHint: "Off-peak tasks will auto-approve sandbox escalations, which may exceed Review Only / Project Files access. Enable only if you trust this provider\u2019s idle work.",
  approvalAllowConfirm: "I understand \u2014 enable",
  approvalAllowCancel: "Cancel",
  overviewTrigger: "Off-peak overview",
  overviewTriggerAria: "Off-peak overview",
  overviewTitle: "Off-peak overview",
  overviewClose: "Close",
  overviewLoading: "Loading\u2026",
  overviewEmpty: "No Off-peak sessions need attention",
  overviewLoadError: "Could not load off-peak overview",
  overviewStatusWaiting: "Waiting for off-peak",
  overviewStatusResume: "Paused \u2014 resume",
  overviewStatusApproval: "Waiting for approval",
  overviewStatusRunning: "Running",
  overviewStatusIdle: "Idle",
  overviewStatusConflict: "Needs confirm",
  overviewStatusOrphan: "Session unavailable",
  overviewNextAt: "Next available {time}",
  overviewParkedUser: "Parked \xB7 {n}",
  overviewParkedResume: "Resume \xB7 {n}",
  overviewParkedMixed: "Resume {r} \xB7 Parked {u}",
  overviewProvider: "Provider {id}",
  overviewFiltersAria: "Filter by status",
  overviewFilterActive: "Needs attention",
  overviewFilterEmpty: "No sessions in this status",
  overviewOrphanHint: "Session is not on this Host; you can discard the queue",
  overviewOpenSession: "Open session",
  overviewRelease: "Start now",
  overviewCancelWait: "Discard pending",
  overviewDiscardOrphan: "Discard",
  overviewKeepResume: "Keep resume first",
  overviewDiscardResume: "Discard resume",
  overviewActionError: "Action failed"
};

// src/client/provider-settings.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STYLE_ID = "dsh-opj-provider-settings-css-v10";
var STYLES = `/* Sit after ProviderEditor in the card flex column (slot DOM is above it). */
.dsh-opj_providerSeat {
  order: 2;
  min-width: 0;
}

.dsh-opj_providerSeat:not([data-open]) {
  display: none;
}

/* Mirror Models ProviderEditor panel (ModelsSection.module.css .editor*). */
.dsh-opj_panel {
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
}

.dsh-opj_panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dsh-opj_panelTitle {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-opj_toggle {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.dsh-opj_toggleInput {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}

.dsh-opj_toggleTrack {
  box-sizing: border-box;
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--dsw-alias-border-l3);
  transition: background-color 120ms ease;
  pointer-events: none;
}

.dsh-opj_toggleThumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-primary, #fff);
  box-shadow: 0 1px 2px rgb(0 0 0 / 18%);
  transition: transform 120ms ease;
  pointer-events: none;
}

.dsh-opj_toggleInput:checked + .dsh-opj_toggleTrack {
  background: var(--dsw-alias-state-success-primary);
}

.dsh-opj_toggleInput:checked + .dsh-opj_toggleTrack .dsh-opj_toggleThumb {
  transform: translateX(16px);
}

.dsh-opj_toggleInput:focus-visible + .dsh-opj_toggleTrack {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.dsh-opj_toggleInput:disabled + .dsh-opj_toggleTrack {
  opacity: 0.5;
}

.dsh-opj_toggle:has(.dsh-opj_toggleInput:disabled) {
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-opj_toggleTrack,
  .dsh-opj_toggleThumb {
    transition: none;
  }
}

.dsh-opj_hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-opj_field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dsh-opj_fieldLabel {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-opj_radioRow {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-opj_radioTitle {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-opj_windowRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.dsh-opj_input,
.dsh-opj_select {
  box-sizing: border-box;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  background: var(--dsw-alias-bg-primary, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.dsh-opj_input:focus-visible,
.dsh-opj_select:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}

.dsh-opj_textButton {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.dsh-opj_textButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dsh-opj_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dsh-opj_primaryButton,
.dsh-opj_secondaryButton {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.dsh-opj_primaryButton {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

.dsh-opj_primaryButton:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}

.dsh-opj_secondaryButton {
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}

.dsh-opj_secondaryButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-opj_primaryButton:disabled,
.dsh-opj_secondaryButton:disabled,
.dsh-opj_textButton:disabled {
  opacity: 0.5;
  cursor: default;
}

.dsh-opj_error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}

/* Beat .dsh-opj_hint color when both classes are present. */
.dsh-opj_hint.dsh-opj_hintError {
  color: var(--dsw-alias-state-error-primary, #d54941);
}

.dsh-opj_hint.dsh-opj_hintWarn {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}

.dsh-opj_saved {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-success-primary);
}
`;
function ensureStyles() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID);
  if (el === null) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = STYLES;
}
async function api(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers ?? {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return body;
}
function translate(t, key) {
  const fromProp = t?.(key);
  if (typeof fromProp === "string" && fromProp.trim() !== "") return fromProp;
  return zh[key] ?? en[key] ?? key;
}
function minToTimeValue(min) {
  const m = (min % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function timeValueToMin(value) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.min(23 * 60 + 59, Math.max(0, h * 60 + m));
}
function normalizeDays(days) {
  return days === "weekdays" || days === "weekends" ? days : "all";
}
function asWindow(w) {
  return { startMin: w.startMin, endMin: w.endMin, days: normalizeDays(w.days) };
}
function cloneWindows(windows) {
  return windows.map((w) => ({ ...w }));
}
function windowKey(w) {
  return `${normalizeDays(w.days)}:${w.startMin}-${w.endMin}`;
}
function draftWindowsOverlap(windows) {
  const finite = windows.filter((w) => w.startMin !== w.endMin);
  if (finite.length < 2) return false;
  const merged = mergeIdleWindows(finite);
  if (merged.length !== finite.length) return true;
  const before = new Set(finite.map(windowKey));
  const after = new Set(merged.map(windowKey));
  if (before.size !== after.size) return true;
  for (const key of before) {
    if (!after.has(key)) return true;
  }
  return false;
}
function editorOpenAround(host) {
  const row = host.closest("li") ?? host.parentElement;
  if (row === null) return true;
  for (const input of row.querySelectorAll("input, select, textarea")) {
    if (!host.contains(input)) return true;
  }
  return false;
}
function asApprovalPolicy(value) {
  return value === "wait" || value === "allow" ? value : "reject";
}
function draftFromPayload(data) {
  const kind = data.config.scheduleKind;
  const windows = data.config.idleWindows?.length ? data.config.idleWindows.map(asWindow) : [asWindow(data.defaultCustomIdle ?? { startMin: 18 * 60, endMin: 9 * 60, days: "all" })];
  const storedChip = data.chipVisible ?? data.config.chipVisible !== false;
  const chipVisible = kind !== "none" && storedChip;
  const windowEndPolicy = data.config.windowEndPolicy === "pause" ? "pause" : "continue";
  const defaultApprovalPolicy = asApprovalPolicy(data.config.defaultApprovalPolicy);
  return {
    kind,
    windows,
    isDeepSeek: data.isDeepSeekOfficial,
    chipVisible,
    windowEndPolicy,
    defaultApprovalPolicy
  };
}
function ProviderPeakSettings(props) {
  ensureStyles();
  const t = (key) => translate(props.t, key);
  const hostRef = (0, import_react.useRef)(null);
  const baselineRef = (0, import_react.useRef)(null);
  const flushConfirmedRef = (0, import_react.useRef)(false);
  const [editorOpen, setEditorOpen] = (0, import_react.useState)(false);
  const [kind, setKind] = (0, import_react.useState)("none");
  const [windows, setWindows] = (0, import_react.useState)([
    { startMin: 18 * 60, endMin: 9 * 60, days: "all" }
  ]);
  const [isDeepSeek, setIsDeepSeek] = (0, import_react.useState)(false);
  const [chipVisible, setChipVisible] = (0, import_react.useState)(true);
  const [windowEndPolicy, setWindowEndPolicy] = (0, import_react.useState)("continue");
  const [defaultApprovalPolicy, setDefaultApprovalPolicy] = (0, import_react.useState)("reject");
  const [waitingCount, setWaitingCount] = (0, import_react.useState)(0);
  const [flushDialogOpen, setFlushDialogOpen] = (0, import_react.useState)(false);
  const [flushDialogKind, setFlushDialogKind] = (0, import_react.useState)("chip-off");
  const [allowConfirmOpen, setAllowConfirmOpen] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [sameTimeSaveError, setSameTimeSaveError] = (0, import_react.useState)(false);
  const [loaded, setLoaded] = (0, import_react.useState)(false);
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [savedFlash, setSavedFlash] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    const host = hostRef.current;
    if (host === null) return;
    const sync = () => {
      setEditorOpen(editorOpenAround(host));
    };
    sync();
    const row = host.closest("li") ?? host.parentElement;
    if (row === null) return;
    const mo = new MutationObserver(sync);
    mo.observe(row, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  const applyDraft = (draft) => {
    setKind(draft.kind);
    setWindows(cloneWindows(draft.windows));
    setIsDeepSeek(draft.isDeepSeek);
    setChipVisible(draft.chipVisible);
    setWindowEndPolicy(draft.windowEndPolicy);
    setDefaultApprovalPolicy(draft.defaultApprovalPolicy);
  };
  const applyPayload = (data) => {
    const draft = draftFromPayload(data);
    baselineRef.current = draft;
    applyDraft(draft);
    setWaitingCount(typeof data.waitingCount === "number" ? data.waitingCount : 0);
    setError(null);
    setSameTimeSaveError(false);
    setLoaded(true);
  };
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const data = await api(
        `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`
      );
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [props.providerId]);
  (0, import_react.useEffect)(() => {
    if (!editorOpen) return;
    void refresh();
  }, [editorOpen, refresh]);
  const cancel = () => {
    const baseline = baselineRef.current;
    if (baseline === null) return;
    applyDraft(baseline);
    setError(null);
    setSameTimeSaveError(false);
    setSavedFlash(false);
    setFlushDialogOpen(false);
    flushConfirmedRef.current = false;
    setAllowConfirmOpen(false);
  };
  const save = async () => {
    if (saving || !loaded) return;
    setSavedFlash(false);
    setError(null);
    setSameTimeSaveError(false);
    const effectiveKind = chipVisible ? kind === "none" ? isDeepSeek ? "deepseek" : "custom" : kind : kind === "none" ? "none" : kind;
    if (chipVisible && effectiveKind === "custom" && windows.some((w) => w.startMin === w.endMin)) {
      setSameTimeSaveError(true);
      return;
    }
    const turningOff = !chipVisible;
    const draftRunsNow = turningOff || !shouldDefer(/* @__PURE__ */ new Date(), {
      scheduleKind: effectiveKind,
      idleWindows: effectiveKind === "custom" ? windows : void 0
    });
    if (!flushConfirmedRef.current && draftRunsNow) {
      try {
        const live = await api(
          `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`
        );
        const count = typeof live.waitingCount === "number" ? live.waitingCount : 0;
        setWaitingCount(count);
        if (count > 0) {
          setFlushDialogKind(turningOff ? "chip-off" : "schedule");
          setFlushDialogOpen(true);
          return;
        }
      } catch {
        if (waitingCount > 0) {
          setFlushDialogKind(turningOff ? "chip-off" : "schedule");
          setFlushDialogOpen(true);
          return;
        }
      }
    }
    flushConfirmedRef.current = false;
    setSaving(true);
    try {
      const idleWindows = chipVisible && effectiveKind === "custom" ? windows : void 0;
      const data = await api(
        `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            scheduleKind: effectiveKind,
            chipVisible,
            windowEndPolicy,
            defaultApprovalPolicy,
            ...idleWindows !== void 0 ? { idleWindows } : {}
          })
        }
      );
      applyPayload(data);
      setSavedFlash(true);
      emitOffpeakProviderConfigChange();
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      const message = e instanceof Error ? e.message : t("saveError");
      if (message.includes("start and end must differ")) {
        setSameTimeSaveError(true);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };
  const setFeatureOn = (on) => {
    setChipVisible(on);
    if (on && kind === "none") setKind(isDeepSeek ? "deepseek" : "custom");
  };
  const confirmFlushSave = () => {
    flushConfirmedRef.current = true;
    setFlushDialogOpen(false);
    void save();
  };
  const cancelFlushSave = () => {
    flushConfirmedRef.current = false;
    setFlushDialogOpen(false);
  };
  const showCustom = kind === "custom" || chipVisible && !isDeepSeek && kind !== "deepseek";
  const hasOvernight = windows.some((w) => w.startMin > w.endMin);
  const hasSameTime = windows.some((w) => w.startMin === w.endMin);
  const hasScopedDays = windows.some((w) => w.days !== "all");
  const hasOverlap = draftWindowsOverlap(windows);
  (0, import_react.useEffect)(() => {
    if (!hasSameTime) setSameTimeSaveError(false);
  }, [hasSameTime]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      ref: hostRef,
      className: "dsh-opj_providerSeat",
      ...editorOpen ? { "data-open": "" } : {},
      children: !editorOpen ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_panelHeader", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_panelTitle", children: t("providerFold") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-opj_toggle", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "dsh-opj_toggleInput",
                type: "checkbox",
                role: "switch",
                checked: chipVisible,
                disabled: saving || !loaded,
                "aria-label": t("chipVisible"),
                onChange: (e) => {
                  setFeatureOn(e.target.checked);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_toggleTrack", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_toggleThumb" }) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Modal,
          {
            open: flushDialogOpen,
            onClose: cancelFlushSave,
            title: t(flushDialogKind === "chip-off" ? "chipOffFlushTitle" : "scheduleFlushTitle"),
            closeLabel: t("chipOffFlushClose"),
            description: t("chipOffFlushHint"),
            footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: cancelFlushSave, children: t("chipOffFlushCancel") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", autoFocus: true, onClick: confirmFlushSave, children: t("chipOffFlushConfirm") })
            ] })
          }
        ),
        !loaded && !error ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          chipVisible && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("providerFoldHint") }),
            isDeepSeek && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "radio",
                  name: `opj-prov-${props.providerId}`,
                  checked: kind === "deepseek",
                  disabled: saving,
                  onChange: () => {
                    setKind("deepseek");
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("kindDeepseek") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("kindDeepseekHint") })
              ] })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "radio",
                  name: `opj-prov-${props.providerId}`,
                  checked: showCustom,
                  disabled: saving,
                  onChange: () => {
                    setKind("custom");
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("kindCustom") })
            ] }) }),
            showCustom && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_field", style: { paddingLeft: 22 }, children: [
              windows.map((w, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_windowRow", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "select",
                  {
                    className: "dsh-opj_select",
                    "aria-label": t("daysLabel"),
                    value: w.days,
                    disabled: saving,
                    onChange: (e) => {
                      const days = normalizeDays(e.target.value);
                      setWindows((list) => list.map((row, i) => i === index ? { ...row, days } : row));
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: t("daysAll") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "weekdays", children: t("daysWeekdays") }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "weekends", children: t("daysWeekends") })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("idleFrom") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "time",
                    className: "dsh-opj_input",
                    value: minToTimeValue(w.startMin),
                    disabled: saving,
                    onChange: (e) => {
                      setWindows((list) => list.map((row, i) => i === index ? { startMin: timeValueToMin(e.target.value), endMin: row.endMin, days: row.days } : row));
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("idleTo") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "time",
                    className: "dsh-opj_input",
                    value: minToTimeValue(w.endMin),
                    disabled: saving,
                    onChange: (e) => {
                      setWindows((list) => list.map((row, i) => i === index ? { startMin: row.startMin, endMin: timeValueToMin(e.target.value), days: row.days } : row));
                    }
                  }
                ),
                windows.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "dsh-opj_textButton",
                    disabled: saving,
                    onClick: () => {
                      setWindows((list) => list.filter((_, i) => i !== index));
                    },
                    children: t("removeWindow")
                  }
                )
              ] }, index)),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "dsh-opj_textButton",
                  style: { alignSelf: "flex-start" },
                  disabled: saving,
                  onClick: () => {
                    setWindows((list) => [
                      ...list,
                      { startMin: 22 * 60, endMin: 8 * 60, days: "all" }
                    ]);
                  },
                  children: t("addWindow")
                }
              ),
              hasOvernight && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("overnightHint") }),
              hasSameTime && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "p",
                {
                  className: sameTimeSaveError ? "dsh-opj_hint dsh-opj_hintError" : "dsh-opj_hint",
                  children: t("windowSameTimeHint")
                }
              ),
              hasScopedDays && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("daysScopeHint") }),
              hasOverlap && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("overlapHint") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("windowEndTitle") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "radio",
                    name: `opj-wend-${props.providerId}`,
                    checked: windowEndPolicy === "continue",
                    disabled: saving,
                    onChange: () => {
                      setWindowEndPolicy("continue");
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("windowEndContinue") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("windowEndContinueHint") })
                ] })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "radio",
                    name: `opj-wend-${props.providerId}`,
                    checked: windowEndPolicy === "pause",
                    disabled: saving,
                    onChange: () => {
                      setWindowEndPolicy("pause");
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("windowEndPause") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("windowEndPauseHint") })
                ] })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("windowEndNote") }),
              baselineRef.current?.windowEndPolicy === "pause" && windowEndPolicy === "continue" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("windowEndSwitchHint") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_field", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("approvalPolicyTitle") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "radio",
                    name: `opj-appr-${props.providerId}`,
                    checked: defaultApprovalPolicy === "reject",
                    disabled: saving,
                    onChange: () => {
                      setDefaultApprovalPolicy("reject");
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("approvalReject") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("approvalRejectHint") })
                ] })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "radio",
                    name: `opj-appr-${props.providerId}`,
                    checked: defaultApprovalPolicy === "wait",
                    disabled: saving,
                    onChange: () => {
                      setDefaultApprovalPolicy("wait");
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("approvalWait") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("approvalWaitHint") })
                ] })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dsh-opj_field", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_fieldLabel", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "radio",
                    name: `opj-appr-${props.providerId}`,
                    checked: defaultApprovalPolicy === "allow",
                    disabled: saving,
                    onChange: () => {
                      if (defaultApprovalPolicy === "allow") return;
                      setAllowConfirmOpen(true);
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-opj_radioRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_radioTitle", children: t("approvalAllow") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-opj_hint", children: t("approvalAllowHint") })
                ] })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_hint", children: t("approvalPolicyHint") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_dsh_client_ui_primitives.Modal,
                {
                  open: allowConfirmOpen,
                  onClose: () => {
                    setAllowConfirmOpen(false);
                  },
                  title: t("approvalAllowConfirmTitle"),
                  closeLabel: t("approvalAllowCancel"),
                  description: t("approvalAllowConfirmHint"),
                  footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_dsh_client_ui_primitives.Button,
                      {
                        variant: "outline",
                        onClick: () => {
                          setAllowConfirmOpen(false);
                        },
                        children: t("approvalAllowCancel")
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_dsh_client_ui_primitives.Button,
                      {
                        variant: "primary",
                        autoFocus: true,
                        onClick: () => {
                          setDefaultApprovalPolicy("allow");
                          setAllowConfirmOpen(false);
                        },
                        children: t("approvalAllowConfirm")
                      }
                    )
                  ] })
                }
              )
            ] })
          ] }),
          error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_error", children: error }),
          savedFlash && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-opj_saved", children: t("providerSaved") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-opj_actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-opj_secondaryButton",
                disabled: saving || !loaded,
                onClick: cancel,
                children: t("providerCancel")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-opj_primaryButton",
                disabled: saving || !loaded,
                onClick: () => {
                  void save();
                },
                children: saving ? t("providerSaving") : t("providerSave")
              }
            )
          ] })
        ] })
      ] })
    }
  );
}

// src/client/overview.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
var STYLE_ID2 = "dsh-opj-overview-css-v4";
var STYLES2 = `
.dsh-opj_ovLayer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dsh-opj_ovLayer[data-rail] { width: 36px; height: 36px; margin: 0; }
.dsh-opj_ovBadge {
  display: inline-flex; align-items: center; gap: 8px;
  width: calc(100% + 4px); height: 42px; margin: 0 -2px; padding: 0 10px 0 8px;
  border: none; border-radius: 12px; background: transparent;
  color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px;
  cursor: pointer; overflow: hidden;
}
.dsh-opj_ovBadge:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-opj_ovBadge[data-active] { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-opj_ovLayer[data-rail] .dsh-opj_ovBadge {
  justify-content: center; gap: 0; width: 36px; height: 36px; padding: 0; border-radius: 50%;
}
.dsh-opj_ovLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-opj_ovCount {
  flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums;
}
.dsh-opj_ovCount[data-attention] {
  color: var(--dsw-alias-state-warn-primary, #f5a623); font-weight: 600;
}
.dsh-opj_ovPanel {
  position: fixed; z-index: 30; display: flex; flex-direction: column;
  width: 440px; max-width: calc(100vw - 24px); max-height: 70vh; overflow: hidden;
  border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-module-platform));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgb(0 0 0 / 18%));
  color: var(--dsw-alias-label-primary);
}
.dsh-opj_ovHead {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px 8px;
}
.dsh-opj_ovTitle { margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.dsh-opj_ovClose {
  box-sizing: border-box; height: 28px; padding: 0 10px; border: none; border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-opj_ovClose:hover {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.dsh-opj_ovFilters {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-opj_ovFilter {
  box-sizing: border-box; height: 26px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 13px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.dsh-opj_ovFilter[data-active] {
  border-color: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-opj_ovBody { overflow: auto; padding: 8px 0 12px; }
.dsh-opj_ovNote, .dsh-opj_ovError {
  margin: 8px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.dsh-opj_ovError { color: var(--dsw-alias-state-error-primary); }
.dsh-opj_ovRow {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 14px;
  border: none; background: transparent; text-align: left;
}
.dsh-opj_ovRow + .dsh-opj_ovRow { border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dsh-opj_ovRowTop { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-opj_ovSession {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  text-align: left; cursor: pointer;
}
.dsh-opj_ovSession:hover {
  color: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary));
  text-decoration: underline;
}
.dsh-opj_ovSession:disabled { cursor: default; text-decoration: none; opacity: 0.7; }
.dsh-opj_ovStatus {
  flex: none; margin-left: auto; font-size: 12px; line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-opj_ovStatus[data-status="conflict"],
.dsh-opj_ovStatus[data-status="resume"],
.dsh-opj_ovStatus[data-status="waiting"],
.dsh-opj_ovStatus[data-status="approval"],
.dsh-opj_ovStatus[data-status="orphan"] {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}
.dsh-opj_ovMeta { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-opj_ovMetaRow {
  display: flex; align-items: baseline; gap: 10px; min-width: 0;
  margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.dsh-opj_ovNext {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-opj_ovProvider {
  flex: 0 1 auto; max-width: 42%;
  margin-left: auto;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: right;
}
.dsh-opj_ovPreview {
  margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-opj_ovActions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.dsh-opj_ovAction {
  box-sizing: border-box; height: 28px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.dsh-opj_ovAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dsh-opj_ovAction[data-primary] {
  border: none; background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-opj_ovAction[data-primary]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dsh-opj_ovAction:disabled { opacity: 0.5; cursor: default; }
`;
var FILTERS = [
  "active",
  "waiting",
  "approval",
  "resume",
  "running",
  "idle",
  "conflict",
  "orphan"
];
function ensureStyles2() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID2);
  if (el === null) {
    el = document.createElement("style");
    el.id = STYLE_ID2;
    document.head.appendChild(el);
  }
  el.textContent = STYLES2;
}
function translate2(t, key, vars) {
  const fromProp = t?.(key, vars);
  let text = typeof fromProp === "string" && fromProp.trim() !== "" ? fromProp : zh[key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
function formatUntil(iso, locale) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch {
    return iso;
  }
}
function shortSessionId(id) {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}\u2026${id.slice(-4)}`;
}
function statusLabel(t, status) {
  switch (status) {
    case "waiting":
      return t("overviewStatusWaiting");
    case "resume":
      return t("overviewStatusResume");
    case "approval":
      return t("overviewStatusApproval");
    case "running":
      return t("overviewStatusRunning");
    case "idle":
      return t("overviewStatusIdle");
    case "conflict":
      return t("overviewStatusConflict");
    case "orphan":
      return t("overviewStatusOrphan");
    default:
      return status;
  }
}
function filterLabel(t, filter) {
  if (filter === "active") return t("overviewFilterActive");
  return statusLabel(t, filter);
}
async function apiJson(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers ?? {} },
    cache: "no-store"
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return body;
}
function OffpeakOverviewInner(props) {
  ensureStyles2();
  const t = (key, vars) => translate2(props.t, key, vars);
  const rootRef = (0, import_react2.useRef)(null);
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [anchor, setAnchor] = (0, import_react2.useState)();
  const [payload, setPayload] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [filter, setFilter] = (0, import_react2.useState)("active");
  const [busyId, setBusyId] = (0, import_react2.useState)(null);
  const [actionError, setActionError] = (0, import_react2.useState)(null);
  const [entryVisible, setEntryVisible] = (0, import_react2.useState)(true);
  const refresh = (0, import_react2.useCallback)(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const next = await apiJson("/api/offpeak-job/overview");
      setPayload(next);
      setEntryVisible(next.entryVisible !== false);
      setError(null);
      if (next.entryVisible === false) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("overviewLoadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  (0, import_react2.useEffect)(() => onOffpeakProviderConfigChange(() => {
    void refresh({ silent: true });
  }), [refresh]);
  (0, import_react2.useEffect)(() => {
    void refresh();
    const ms = open ? 1e3 : 5e3;
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, ms);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, refresh]);
  (0, import_react2.useLayoutEffect)(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect !== void 0) {
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [open]);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const onPointer = (event) => {
      const root = rootRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const rows = (0, import_react2.useMemo)(() => {
    const list = payload?.sessions ?? [];
    if (filter === "active") return list.filter((row) => row.status !== "idle");
    return list.filter((row) => row.status === filter);
  }, [payload, filter]);
  const runRow = async (sessionId, work) => {
    setBusyId(sessionId);
    setActionError(null);
    try {
      await work();
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("overviewActionError"));
    } finally {
      setBusyId(null);
    }
  };
  const release = (row) => {
    const q = row.providerId ? `?provider=${encodeURIComponent(row.providerId)}` : "";
    void runRow(row.sessionId, async () => {
      await apiJson(`/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/release${q}`, {
        method: "POST",
        body: "{}"
      });
    });
  };
  const cancelWait = (row) => {
    void runRow(row.sessionId, async () => {
      await apiJson(`/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/cancel-wait`, {
        method: "POST",
        body: "{}"
      });
    });
  };
  const resolveConflict = (row, action) => {
    const q = row.providerId ? `?provider=${encodeURIComponent(row.providerId)}` : "";
    void runRow(row.sessionId, async () => {
      await apiJson(
        `/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/resolve-send${q}`,
        { method: "POST", body: JSON.stringify({ action }) }
      );
    });
  };
  const badgeCount = payload?.badgeCount ?? 0;
  const locale = typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh-CN" : "en";
  const canOpen = typeof props.openSession === "function";
  if (!entryVisible) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      ref: rootRef,
      className: "dsh-opj_ovLayer",
      ...props.wide ? {} : { "data-rail": "" },
      children: [
        open && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "section",
          {
            className: "dsh-opj_ovPanel",
            style: anchor ? { left: anchor.left, bottom: anchor.bottom } : void 0,
            role: "dialog",
            "aria-label": t("overviewTitle"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "dsh-opj_ovHead", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: "dsh-opj_ovTitle", children: t("overviewTitle") }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-opj_ovClose", onClick: () => {
                  setOpen(false);
                }, children: t("overviewClose") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-opj_ovFilters", role: "tablist", "aria-label": t("overviewFiltersAria"), children: FILTERS.map((id) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  role: "tab",
                  className: "dsh-opj_ovFilter",
                  "aria-selected": filter === id,
                  ...filter === id ? { "data-active": "" } : {},
                  onClick: () => {
                    setFilter(id);
                  },
                  children: filterLabel(t, id)
                },
                id
              )) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-opj_ovBody", children: [
                error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovError", role: "alert", children: error }),
                actionError && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovError", role: "alert", children: actionError }),
                !error && loading && payload === null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovNote", children: t("overviewLoading") }),
                !error && payload !== null && rows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovNote", children: filter === "active" ? t("overviewEmpty") : t("overviewFilterEmpty") }),
                rows.map((row) => {
                  const busy = busyId === row.sessionId;
                  const title = props.titles[row.sessionId] || shortSessionId(row.sessionId);
                  const isOrphan = row.status === "orphan" || row.orphan === true;
                  const windowWait = row.windowWait === true;
                  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-opj_ovRow", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-opj_ovRowTop", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "dsh-opj_ovSession",
                          title: row.sessionId,
                          disabled: !canOpen || isOrphan,
                          onClick: () => {
                            if (!canOpen || isOrphan) return;
                            props.openSession?.(row.sessionId);
                            setOpen(false);
                          },
                          children: title
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-opj_ovStatus", "data-status": row.status, children: statusLabel(t, row.status) })
                    ] }),
                    isOrphan && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovMeta", children: t("overviewOrphanHint") }),
                    (row.waitingUntil || row.providerId) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-opj_ovMetaRow", children: [
                      row.waitingUntil ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-opj_ovNext", children: t("overviewNextAt", { time: formatUntil(row.waitingUntil, locale) }) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-opj_ovNext" }),
                      row.providerId && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "span",
                        {
                          className: "dsh-opj_ovProvider",
                          title: row.providerId,
                          children: t("overviewProvider", { id: row.providerId })
                        }
                      )
                    ] }),
                    (row.parkedUser > 0 || row.parkedResume > 0) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovMeta", children: row.parkedResume > 0 && row.parkedUser > 0 ? t("overviewParkedMixed", { r: row.parkedResume, u: row.parkedUser }) : row.parkedResume > 0 ? t("overviewParkedResume", { n: row.parkedResume }) : t("overviewParkedUser", { n: row.parkedUser }) }),
                    row.textPreview && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-opj_ovPreview", children: row.textPreview }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-opj_ovActions", children: [
                      canOpen && !isOrphan && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "dsh-opj_ovAction",
                          disabled: busy,
                          onClick: () => {
                            props.openSession?.(row.sessionId);
                            setOpen(false);
                          },
                          children: t("overviewOpenSession")
                        }
                      ),
                      windowWait && !isOrphan && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "dsh-opj_ovAction",
                          "data-primary": "",
                          disabled: busy,
                          onClick: () => {
                            release(row);
                          },
                          children: t("overviewRelease")
                        }
                      ),
                      windowWait && !isOrphan && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "dsh-opj_ovAction",
                          disabled: busy,
                          onClick: () => {
                            cancelWait(row);
                          },
                          children: t("overviewCancelWait")
                        }
                      ),
                      isOrphan && windowWait && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "dsh-opj_ovAction",
                          "data-primary": "",
                          disabled: busy,
                          onClick: () => {
                            cancelWait(row);
                          },
                          children: t("overviewDiscardOrphan")
                        }
                      ),
                      row.sendConflict && !isOrphan && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            className: "dsh-opj_ovAction",
                            disabled: busy,
                            onClick: () => {
                              resolveConflict(row, "keep-resume");
                            },
                            children: t("overviewKeepResume")
                          }
                        ),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            className: "dsh-opj_ovAction",
                            disabled: busy,
                            onClick: () => {
                              resolveConflict(row, "discard-resume");
                            },
                            children: t("overviewDiscardResume")
                          }
                        )
                      ] })
                    ] })
                  ] }, row.sessionId);
                })
              ] })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            className: "dsh-opj_ovBadge",
            "data-active": open || badgeCount > 0 || void 0,
            "aria-label": t("overviewTriggerAria"),
            "aria-expanded": open,
            onClick: () => {
              setOpen((value) => !value);
              if (!open) void refresh();
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconClockOutline16, { size: props.wide ? 16 : 18 }),
              props.wide && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-opj_ovLabel", children: t("overviewTrigger") }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "span",
                  {
                    className: "dsh-opj_ovCount",
                    ...badgeCount > 0 ? { "data-attention": "" } : {},
                    children: badgeCount
                  }
                )
              ] })
            ]
          }
        )
      ]
    }
  );
}
function OffpeakOverviewWithTitles(props) {
  const titles = props.useSessions((state) => {
    const byId = state?.byId;
    if (byId === null || typeof byId !== "object") return {};
    const out = {};
    for (const [id, row] of Object.entries(byId)) {
      const title = typeof row?.displayTitle === "string" ? row.displayTitle : typeof row?.title === "string" ? row.title : void 0;
      if (title) out[id] = title;
    }
    return out;
  });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(OffpeakOverviewInner, { ...props, titles });
}
function OffpeakOverviewEntry(props) {
  if (typeof props.useSessions === "function") {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      OffpeakOverviewWithTitles,
      {
        wide: props.wide,
        t: props.t,
        openSession: props.openSession,
        useSessions: props.useSessions
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(OffpeakOverviewInner, { ...props, titles: {} });
}

// src/client/index.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var NS = "offpeak-job";
var STYLE_ID3 = "dsh-opj-chip-css-v7";
var DOCK_STYLE_ID = "dsh-opj-wait-dock-css-v7";
var CHIP_STYLES = `
.dsh-opj_trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.dsh-opj_trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-opj_trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.dsh-opj_trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.dsh-opj_triggerOffpeak {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}

.dsh-opj_triggerWait {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}

.dsh-opj_triggerIcon {
  display: inline-flex;
  flex: 0 0 auto;
}

.dsh-opj_triggerIcon svg {
  width: 14px;
  height: 14px;
}

.dsh-opj_triggerLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-opj_chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.dsh-opj_chevronOpen {
  transform: rotate(180deg);
}

.dsh-opj_item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 2px;
  /* Match agent-preset / \u8FD0\u884C\u6A21\u5F0F menu card width (Menu list min 218 \u2192 ~300+). */
  box-sizing: border-box;
  min-width: 300px;
  max-width: 340px;
  align-items: start;
}

.dsh-opj_itemIcon {
  display: inline-flex;
  width: 16px;
  height: 20px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-opj_itemName {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}

.dsh-opj_itemDesc {
  grid-column: 2;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
  white-space: normal;
}

.dsh-opj_windowsAccent {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-opj_chevron {
    transition: none;
  }
}
`;
var WAIT_DOCK_STYLES = `
.dsh-opj_waitDock {
  box-sizing: border-box;
  flex: none;
  min-width: 0;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);
  padding: 0 var(--dsh-composer-dock-inset);
  overflow: hidden;
}

.dsh-opj_waitPanel {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 12px 12px 0 0;
  background: var(--dsw-specific-tip);
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
}

.dsh-opj_waitPanel::after {
  position: absolute;
  inset: 0;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-bottom: none;
  border-radius: inherit;
  content: '';
  pointer-events: none;
}

.dsh-opj_waitLead {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}

.dsh-opj_waitLead svg {
  width: 14px;
  height: 14px;
}

.dsh-opj_waitCopy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.dsh-opj_waitTitle {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

.dsh-opj_waitDetail {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
}

.dsh-opj_waitAction {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}

.dsh-opj_waitAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-opj_waitAction:disabled {
  opacity: 0.6;
  cursor: default;
}

.dsh-opj_waitParked {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

.dsh-opj_waitParkedLabel {
  margin-bottom: 2px;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-caption);
}

.dsh-opj_waitParkedList {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-opj_waitParkedItem {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 28px;
  padding: 4px 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-opj_waitParkedItem + .dsh-opj_waitParkedItem {
  box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1);
}
`;
function ensureChipStyles() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID3);
  if (el === null) {
    el = document.createElement("style");
    el.id = STYLE_ID3;
    document.head.appendChild(el);
  }
  el.textContent = CHIP_STYLES;
}
function ensureWaitDockStyles() {
  if (typeof document === "undefined") return;
  let el = document.getElementById(DOCK_STYLE_ID);
  if (el === null) {
    el = document.createElement("style");
    el.id = DOCK_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = WAIT_DOCK_STYLES;
}
async function api2(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers ?? {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return body;
}
function translate3(t, key) {
  const fromProp = t?.(key);
  if (typeof fromProp === "string" && fromProp.trim() !== "") return fromProp;
  return zh[key] ?? en[key] ?? key;
}
function resolveProviderFromProps(props) {
  try {
    const proj = props.useProjection?.("modelSelection");
    const next = proj?.next ?? proj?.pending;
    const last = proj?.lastUsed;
    const id = next?.provider ?? last?.provider;
    if (typeof id === "string" && id.length > 0) return id;
  } catch {
  }
  return void 0;
}
function formatNextAt(iso) {
  if (iso === null) return "";
  return new Date(iso).toLocaleString(void 0, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function minToClock(min) {
  const m = (min % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function formatIdleWindow(w, t) {
  const range = w.startMin === w.endMin ? t("daysFullDay") : `${minToClock(w.startMin)}\u2013${minToClock(w.endMin)}`;
  const days = w.days === "weekdays" || w.days === "weekends" ? w.days : "all";
  if (days === "all") return `${t("daysAll")} ${range}`;
  if (days === "weekdays") return `${t("daysWeekdays")} ${range}`;
  return `${t("daysWeekends")} ${range}`;
}
function formatScheduleWindows(kind, windows, t) {
  if (kind === "deepseek") return t("kindDeepseekHint");
  if (windows === void 0 || windows.length === 0) return t("kindDeepseekHint");
  return windows.map((w) => formatIdleWindow(w, t)).join("\uFF1B");
}
function menuLabel(icon, name, description) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-opj_item", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_itemIcon", "aria-hidden": true, children: icon }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_itemName", children: name }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_itemDesc", children: description })
  ] });
}
function offpeakWindowsDescription(template, windowsText) {
  const parts = template.split("{windows}");
  if (parts.length < 2) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_jsx_runtime3.Fragment, { children: template.replace("{windows}", windowsText) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    parts[0],
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_windowsAccent", children: windowsText }),
    parts.slice(1).join("{windows}")
  ] });
}
function OffpeakWaitDock(props) {
  ensureWaitDockStyles();
  const { sessionId, useSession } = props;
  const t = (key) => translate3(props.t, key);
  const providerId = props.providerId ?? "deepseek-official";
  const [waitingUntil, setWaitingUntil] = (0, import_react3.useState)(null);
  const [parked, setParked] = (0, import_react3.useState)([]);
  const [resumePending, setResumePending] = (0, import_react3.useState)(false);
  const [sendConflict, setSendConflict] = (0, import_react3.useState)(false);
  const [deferredNow, setDeferredNow] = (0, import_react3.useState)(false);
  const [nextOffpeak, setNextOffpeak] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const dockRef = (0, import_react3.useRef)(null);
  const queueFingerprint = useSession((s) => {
    const queue = Array.isArray(s.queue) ? s.queue : [];
    const pending = Array.isArray(s.pendingSubmissions) ? s.pendingSubmissions : [];
    const queued = queue.filter((row) => row?.placement === "queued").map((row) => row.id).join(",");
    const pendingQueued = pending.filter((row) => row?.placement === "queued").map((row) => row.requestId).join(",");
    return `${queued}|${pendingQueued}`;
  });
  const hasQueueRows = queueFingerprint !== "|" && queueFingerprint !== "";
  const refresh = (0, import_react3.useCallback)(async () => {
    try {
      const q = `?provider=${encodeURIComponent(providerId)}`;
      const data = await api2(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}${q}`
      );
      setWaitingUntil(typeof data.waitingUntil === "string" ? data.waitingUntil : null);
      setParked((data.parked ?? []).filter((row) => row.kind !== "notice").map((row) => ({
        id: row.id,
        textPreview: row.textPreview,
        kind: row.kind === "resume" ? "resume" : "user",
        inboxMirrored: row.inboxMirrored === true
      })));
      setResumePending(Boolean(data.resumePending) || (data.parked ?? []).some((r) => r.kind === "resume"));
      setSendConflict(Boolean(data.sendConflict));
      setDeferredNow(Boolean(data.deferredNow ?? data.isPeakNow));
      setNextOffpeak(typeof data.nextOffpeak === "string" ? data.nextOffpeak : null);
    } catch {
      setWaitingUntil(null);
      setParked([]);
      setResumePending(false);
      setSendConflict(false);
      setDeferredNow(false);
      setNextOffpeak(null);
    }
  }, [sessionId, providerId]);
  (0, import_react3.useEffect)(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 2e3);
    return () => clearInterval(id);
  }, [refresh]);
  (0, import_react3.useEffect)(() => {
    void refresh();
    if (!hasQueueRows) return;
    const timers = [80, 200, 500].map((ms) => window.setTimeout(() => {
      void refresh();
    }, ms));
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [queueFingerprint, hasQueueRows, refresh]);
  (0, import_react3.useEffect)(() => onOffpeakProviderConfigChange(() => {
    void refresh();
  }), [refresh]);
  const displayUntil = parked.length > 0 ? waitingUntil : hasQueueRows ? waitingUntil ?? (deferredNow ? nextOffpeak : null) : null;
  const show = !(displayUntil === null && parked.length === 0);
  (0, import_react3.useLayoutEffect)(() => {
    const wait = dockRef.current;
    if (wait === null || !show) return;
    const clear = () => {
      wait.removeAttribute("data-match-queue");
      wait.style.removeProperty("width");
      wait.style.removeProperty("max-width");
    };
    const sync = () => {
      const seat2 = wait.closest("[data-composer-seat]") ?? document.querySelector("[data-composer-seat]");
      const queue2 = seat2?.querySelector("[data-queue-dock]");
      if (queue2 === null || !hasQueueRows) {
        clear();
        return;
      }
      const q = queue2.getBoundingClientRect();
      if (q.width < 1) {
        clear();
        return;
      }
      wait.setAttribute("data-match-queue", "");
      wait.style.width = `${q.width}px`;
      wait.style.maxWidth = `${q.width}px`;
    };
    sync();
    const seat = wait.closest("[data-composer-seat]") ?? document.querySelector("[data-composer-seat]");
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    const queue = seat?.querySelector("[data-queue-dock]");
    if (ro !== null) {
      ro.observe(wait);
      if (queue !== null) ro.observe(queue);
      if (wait.parentElement !== null) ro.observe(wait.parentElement);
    }
    window.addEventListener("resize", sync);
    const mo = seat === null ? null : new MutationObserver(sync);
    mo?.observe(seat, { childList: true, subtree: true });
    const retry = window.setTimeout(sync, 50);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
      mo?.disconnect();
      clear();
    };
  }, [show, hasQueueRows, queueFingerprint]);
  const resumeCount = parked.filter((row) => row.kind === "resume").length;
  const totalUserCount = parked.length - resumeCount;
  const visibleParked = parked.filter((row) => {
    if (row.kind === "resume") return true;
    if (row.inboxMirrored === true && hasQueueRows) return false;
    return true;
  });
  const visibleUserCount = visibleParked.filter((row) => row.kind !== "resume").length;
  const isResumeMode = resumeCount > 0;
  const detail = displayUntil === null ? t("waitDockEmpty") : t(isResumeMode ? "waitDockResumeDetail" : "waitDockDetail").replace("{time}", formatNextAt(displayUntil));
  const visibleResumeCount = visibleParked.filter((row) => row.kind === "resume").length;
  const parkedLabel = visibleUserCount > 0 && visibleResumeCount > 0 ? t("waitDockMixedParked").replace("{r}", String(visibleResumeCount)).replace("{u}", String(visibleUserCount)) : isResumeMode && visibleUserCount === 0 ? t("waitDockResumeParked").replace("{n}", String(visibleResumeCount || resumeCount)) : t("waitDockParked").replace("{n}", String(visibleParked.length));
  if (!show) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { ref: dockRef, className: "dsh-opj_waitDock", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: sendConflict && resumePending,
        onClose: () => {
          void api2(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
            method: "POST",
            body: JSON.stringify({ action: "keep-resume" })
          }).then(() => refresh());
        },
        title: t("resumeConflictTitle"),
        closeLabel: t("resumeConflictClose"),
        description: t("resumeConflictHint"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "outline",
              onClick: () => {
                void api2(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
                  method: "POST",
                  body: JSON.stringify({ action: "discard-resume" })
                }).then(() => refresh());
              },
              children: t("resumeConflictDiscard")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              variant: "primary",
              autoFocus: true,
              onClick: () => {
                void api2(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
                  method: "POST",
                  body: JSON.stringify({ action: "keep-resume" })
                }).then(() => refresh());
              },
              children: t("resumeConflictKeep")
            }
          )
        ] })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: "dsh-opj_waitPanel",
        style: { flexWrap: "wrap" },
        role: "status",
        "aria-live": "polite",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitLead", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconClockOutline16, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-opj_waitCopy", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitTitle", children: t(isResumeMode ? "waitDockResumeTitle" : "waitDockTitle") }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitDetail", children: detail }),
            visibleParked.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-opj_waitParked", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitParkedLabel", children: parkedLabel }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitParkedList", children: visibleParked.map((row) => {
                const preview = row.kind === "resume" ? t("waitDockResumePreview") : row.textPreview || "\u2026";
                return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_waitParkedItem", title: preview, children: preview }, row.id);
              }) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: "dsh-opj_waitAction",
              disabled: busy,
              onClick: () => {
                setBusy(true);
                void api2(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/cancel-wait`, {
                  method: "POST"
                }).then(() => {
                  setWaitingUntil(null);
                  setParked([]);
                  setResumePending(false);
                  setSendConflict(false);
                  return refresh();
                }).finally(() => setBusy(false));
              },
              children: t(isResumeMode && totalUserCount === 0 ? "waitDockResumeCancel" : "waitDockCancel")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: "dsh-opj_waitAction",
              disabled: busy,
              onClick: () => {
                setBusy(true);
                void api2(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/release?provider=${encodeURIComponent(providerId)}`, {
                  method: "POST"
                }).then(() => {
                  setWaitingUntil(null);
                  setParked([]);
                  setResumePending(false);
                  setSendConflict(false);
                  return refresh();
                }).finally(() => setBusy(false));
              },
              children: t(isResumeMode ? "waitDockResumeRunNow" : "waitDockRunNow")
            }
          )
        ]
      }
    )
  ] });
}
function OffpeakControl(props) {
  ensureChipStyles();
  const { sessionId } = props;
  const t = (key) => translate3(props.t, key);
  const providerId = props.providerId ?? "deepseek-official";
  const [enabled, setEnabled] = (0, import_react3.useState)(false);
  const [scheduleActive, setScheduleActive] = (0, import_react3.useState)(false);
  const [showComposerChip, setShowComposerChip] = (0, import_react3.useState)(false);
  const [scheduleKind, setScheduleKind] = (0, import_react3.useState)("none");
  const [idleWindows, setIdleWindows] = (0, import_react3.useState)([]);
  const [deferredNow, setDeferredNow] = (0, import_react3.useState)(false);
  const [nextOffpeak, setNextOffpeak] = (0, import_react3.useState)(null);
  const [waitingUntil, setWaitingUntil] = (0, import_react3.useState)(null);
  const [parkedCount, setParkedCount] = (0, import_react3.useState)(0);
  const [error, setError] = (0, import_react3.useState)(null);
  const [open, setOpen] = (0, import_react3.useState)(false);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const applyPayload = (data) => {
    const active = data.scheduleActive ?? data.provider?.scheduleActive ?? data.provider?.config.scheduleKind !== "none";
    const chip = data.showComposerChip ?? data.provider?.showComposerChip ?? ((data.chipVisible ?? data.provider?.chipVisible ?? data.provider?.config.chipVisible) !== false && active);
    setEnabled(data.config.enabled);
    setScheduleActive(active);
    setShowComposerChip(chip);
    setScheduleKind(data.provider?.config.scheduleKind ?? "none");
    setIdleWindows(data.provider?.config.idleWindows?.map((w) => ({ ...w })) ?? []);
    setDeferredNow(data.deferredNow ?? data.isPeakNow);
    setNextOffpeak(data.nextOffpeak);
    setWaitingUntil(typeof data.waitingUntil === "string" ? data.waitingUntil : null);
    setParkedCount(data.parked?.length ?? 0);
    setError(null);
  };
  const refresh = (0, import_react3.useCallback)(async () => {
    try {
      const q = `?provider=${encodeURIComponent(providerId)}`;
      const data = await api2(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}${q}`
      );
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [sessionId, providerId]);
  (0, import_react3.useEffect)(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 15e3);
    return () => clearInterval(id);
  }, [refresh]);
  (0, import_react3.useEffect)(() => onOffpeakProviderConfigChange(() => {
    void refresh();
  }), [refresh]);
  (0, import_react3.useEffect)(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);
  (0, import_react3.useEffect)(() => {
    if (!scheduleActive || !showComposerChip) setOpen(false);
  }, [scheduleActive, showComposerChip]);
  const persist = async (nextEnabled) => {
    if (!scheduleActive || !showComposerChip || busy) return;
    if (nextEnabled === enabled) return;
    setBusy(true);
    try {
      const data = await api2(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}`,
        {
          method: "PUT",
          body: JSON.stringify({ enabled: nextEnabled, provider: providerId })
        }
      );
      applyPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveError"));
    } finally {
      setBusy(false);
    }
  };
  if (!showComposerChip) return null;
  const interactive = scheduleActive;
  const waiting = interactive && enabled && (parkedCount > 0 || waitingUntil !== null || deferredNow);
  const offpeak = interactive && enabled;
  const selectedId = offpeak ? "offpeak" : "immediate";
  const triggerLabel = offpeak ? t("chipOffpeak") : t("chipImmediate");
  const TriggerIcon = offpeak ? import_dsh_client_ui_primitives3.IconClockOutline16 : import_dsh_client_ui_primitives3.IconPlayOutline16;
  let title;
  if (!interactive) {
    title = t("chipTitleUnavailable");
  } else if (!offpeak) {
    title = t("chipTitleImmediate");
  } else {
    title = void 0;
  }
  const windowsText = formatScheduleWindows(scheduleKind, idleWindows, t);
  const offpeakDesc = offpeakWindowsDescription(t("menuOffpeakDesc"), windowsText);
  const items = [
    {
      id: "offpeak",
      label: menuLabel(/* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconClockOutline16, {}), t("menuOffpeak"), offpeakDesc)
    },
    {
      id: "immediate",
      label: menuLabel(/* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconPlayOutline16, {}), t("menuImmediate"), t("menuImmediateDesc"))
    }
  ];
  const triggerClass = [
    "dsh-opj_trigger",
    waiting ? "dsh-opj_triggerWait" : offpeak ? "dsh-opj_triggerOffpeak" : ""
  ].filter(Boolean).join(" ");
  const trigger = /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "button",
    {
      type: "button",
      className: triggerClass,
      "aria-label": t("chipAriaCurrent").replace("{name}", triggerLabel),
      title,
      disabled: !interactive || busy,
      onClick: () => {
        if (!interactive || busy) return;
        if (open) {
          setOpen(false);
          return;
        }
        void refresh().then(() => {
          setOpen(true);
        });
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_triggerIcon", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TriggerIcon, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-opj_triggerLabel", children: triggerLabel }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "span",
          {
            className: open ? "dsh-opj_chevron dsh-opj_chevronOpen" : "dsh-opj_chevron",
            "aria-hidden": true,
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconChevronDownOutline14, {})
          }
        )
      ]
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: "var(--dsw-alias-state-error-primary, #b00020)", fontSize: 11, maxWidth: 120 }, children: error }) : null,
    interactive ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      import_dsh_client_ui_primitives3.Menu,
      {
        open,
        items,
        selectedId,
        onSelect: (id) => {
          setOpen(false);
          void persist(id === "offpeak");
        },
        onClose: () => {
          setOpen(false);
        },
        side: "top",
        anchor: trigger
      }
    ) : trigger
  ] });
}
var inject = ["slots", "locale"];
function apply(ctx) {
  if (ctx.locale?.register) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "offpeak-job: locale");
  }
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "offpeak-job",
    order: 10,
    locale: NS
  }, (props) => {
    const sessionId = props.sessionId;
    if (!sessionId) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      OffpeakControl,
      {
        sessionId,
        providerId: resolveProviderFromProps(props),
        t: props.t
      }
    );
  }));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "offpeak-wait",
    order: 15,
    locale: NS
  }, (props) => {
    const sessionId = props.sessionId;
    if (!sessionId || typeof props.useSession !== "function") return null;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      OffpeakWaitDock,
      {
        sessionId,
        providerId: resolveProviderFromProps(props),
        useSession: props.useSession,
        t: props.t
      }
    );
  }));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "offpeak-overview",
    order: 15,
    locale: NS,
    inject: () => ({
      openSession: (sessionId) => {
        const sessions = ctx.get?.("sessions") ?? ctx.sessions;
        if (sessions && typeof sessions.open === "function") {
          sessions.open(sessionId);
        }
      }
    })
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    OffpeakOverviewEntry,
    {
      wide: props.wide !== false,
      t: props.t,
      openSession: props.openSession,
      useSessions: props.useSessions
    }
  )));
  for (const key of ["llm-deepseek", "llm-pi-ai"]) {
    ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
      name: "settings.models.provider-card",
      key,
      id: `offpeak-job:${key}`,
      locale: NS
    }, (props) => {
      const providerId = props.provider?.provider;
      if (!providerId) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ProviderPeakSettings, { providerId, t: props.t });
    }));
  }
}
return module.exports; } });
