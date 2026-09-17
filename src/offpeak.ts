/**
 * Schedule policy: DeepSeek peak/idle, custom 谷时 windows, or none.
 * DeepSeek source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 */

import {
  DEEPSEEK_OFFICIAL_PROVIDER,
  type ScheduleKind,
  type SchedulePolicy,
  type TimeWindow,
  type WindowDays,
} from './types.ts'

export const DEEPSEEK_PEAK_WINDOWS: readonly TimeWindow[] = [
  { startMin: 9 * 60, endMin: 12 * 60 },
  { startMin: 14 * 60, endMin: 18 * 60 },
]

/** Sensible first custom 谷时 when the user switches to custom. */
export const DEFAULT_CUSTOM_IDLE: TimeWindow = {
  startMin: 18 * 60,
  endMin: 9 * 60,
  days: 'all',
}

export const PEAK_WINDOWS_NOTE =
  'DeepSeek peak (Asia/Shanghai): Mon–Fri 09:00–12:00 and 14:00–18:00; else idle (~½ price).'

const DAY_MINS = 24 * 60

const DAYS_ORDER: readonly WindowDays[] = ['all', 'weekdays', 'weekends']

export function defaultKindForProvider(providerId: string): ScheduleKind {
  return providerId === DEEPSEEK_OFFICIAL_PROVIDER ? 'deepseek' : 'none'
}

export function shanghaiParts(date: Date): {
  weekday: number
  hour: number
  minute: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const map: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    weekday: weekdayMap[map.weekday ?? 'Sun'] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

/** Normalize optional/legacy `days` to a closed tag. */
export function normalizeWindowDays(days: unknown): WindowDays {
  return days === 'weekdays' || days === 'weekends' ? days : 'all'
}

/** Whether Shanghai `weekday` (0=Sun…6=Sat) matches a window's days tag. */
export function daysMatch(days: WindowDays | undefined, weekday: number): boolean {
  const tag = normalizeWindowDays(days)
  if (tag === 'all') return true
  if (tag === 'weekdays') return weekday >= 1 && weekday <= 5
  return weekday === 0 || weekday === 6
}

function inWindow(mins: number, w: TimeWindow): boolean {
  if (w.startMin === w.endMin) return true // full day
  if (w.startMin < w.endMin) return mins >= w.startMin && mins < w.endMin
  return mins >= w.startMin || mins < w.endMin
}

/**
 * Merge overlapping 谷时 windows (including overnight).
 * Same-`days` rows merge first; then every-day (`all`) coverage subtracts from
 * weekdays/weekends so redundant narrower scopes are dropped or trimmed.
 * Example: all 18:00–12:00 + weekdays 22:00–08:00 → only all 18:00–12:00.
 */
export function mergeIdleWindows(windows: readonly TimeWindow[]): TimeWindow[] {
  if (windows.length === 0) return []

  const byDays = new Map<WindowDays, TimeWindow[]>()
  for (const w of windows) {
    const days = normalizeWindowDays(w.days)
    const list = byDays.get(days) ?? []
    list.push({ startMin: w.startMin, endMin: w.endMin, days })
    byDays.set(days, list)
  }

  const mergedByDays = new Map<WindowDays, Array<Pick<TimeWindow, 'startMin' | 'endMin'>>>()
  for (const days of DAYS_ORDER) {
    const group = byDays.get(days)
    if (group === undefined) continue
    mergedByDays.set(days, mergeSameDayWindows(group))
  }

  const allCovered = coverageFromWindows(mergedByDays.get('all') ?? [])
  const out: TimeWindow[] = []
  for (const range of mergedByDays.get('all') ?? []) {
    out.push({ ...range, days: 'all' })
  }
  for (const days of ['weekdays', 'weekends'] as const) {
    const ranges = mergedByDays.get(days)
    if (ranges === undefined) continue
    for (const range of subtractCoverage(ranges, allCovered)) {
      out.push({ ...range, days })
    }
  }
  return out
}

function paintWindow(covered: boolean[], w: Pick<TimeWindow, 'startMin' | 'endMin'>): void {
  if (w.startMin === w.endMin) {
    covered.fill(true)
    return
  }
  if (w.startMin < w.endMin) {
    for (let m = w.startMin; m < w.endMin; m++) covered[m] = true
    return
  }
  for (let m = w.startMin; m < DAY_MINS; m++) covered[m] = true
  for (let m = 0; m < w.endMin; m++) covered[m] = true
}

function coverageFromWindows(windows: readonly Pick<TimeWindow, 'startMin' | 'endMin'>[]): boolean[] {
  const covered = new Array<boolean>(DAY_MINS).fill(false)
  for (const w of windows) paintWindow(covered, w)
  return covered
}

/** Keep minutes in `ranges` that are not already true in `subtract`. */
function subtractCoverage(
  ranges: readonly Pick<TimeWindow, 'startMin' | 'endMin'>[],
  subtract: readonly boolean[],
): Array<Pick<TimeWindow, 'startMin' | 'endMin'>> {
  const kept = new Array<boolean>(DAY_MINS).fill(false)
  for (const w of ranges) paintWindow(kept, w)
  for (let m = 0; m < DAY_MINS; m++) {
    if (subtract[m]) kept[m] = false
  }
  return runsFromCoverage(kept)
}

function runsFromCoverage(covered: readonly boolean[]): Array<Pick<TimeWindow, 'startMin' | 'endMin'>> {
  if (covered.every(Boolean)) return [{ startMin: 0, endMin: 0 }]

  const runs: Array<{ startMin: number; endMin: number }> = []
  let i = 0
  while (i < DAY_MINS) {
    if (!covered[i]) {
      i++
      continue
    }
    const startMin = i
    while (i < DAY_MINS && covered[i]) i++
    runs.push({ startMin, endMin: i })
  }

  if (runs.length === 0) return []

  // Join wrap-around: […, 1440) with [0, …) → one overnight window.
  if (runs.length >= 2 && runs[0]!.startMin === 0 && runs[runs.length - 1]!.endMin === DAY_MINS) {
    const morning = runs.shift()!
    const evening = runs.pop()!
    runs.push({ startMin: evening.startMin, endMin: morning.endMin })
  }

  return runs.map(run => (
    run.endMin === DAY_MINS
      ? { startMin: run.startMin, endMin: 0 }
      : { startMin: run.startMin, endMin: run.endMin }
  ))
}

function mergeSameDayWindows(windows: readonly TimeWindow[]): Array<Pick<TimeWindow, 'startMin' | 'endMin'>> {
  if (windows.length === 1) return [{ startMin: windows[0]!.startMin, endMin: windows[0]!.endMin }]
  return runsFromCoverage(coverageFromWindows(windows))
}

export function sanitizeIdleWindows(windows: readonly TimeWindow[] | undefined): TimeWindow[] {
  if (windows === undefined || windows.length === 0) return [{ ...DEFAULT_CUSTOM_IDLE }]
  const cleaned = windows.filter(w =>
    Number.isFinite(w.startMin) && Number.isFinite(w.endMin)
    && w.startMin >= 0 && w.startMin < DAY_MINS
    && w.endMin >= 0 && w.endMin < DAY_MINS,
  ).map(w => ({
    startMin: w.startMin,
    endMin: w.endMin,
    days: normalizeWindowDays(w.days),
  }))
  return cleaned.length === 0 ? [{ ...DEFAULT_CUSTOM_IDLE }] : cleaned
}

/** Thrown / returned when a custom window has equal start and end (zero duration). */
export const ZERO_DURATION_IDLE_WINDOW =
  'Idle window start and end must differ (same clock time is not a valid range)'

/**
 * Reject zero-duration custom windows before merge/persist.
 * `startMin === endMin` is reserved for internal full-day coverage after merge,
 * not for user-authored ranges such as 09:00–09:00.
 *
 * @param windows - draft or PATCH idle windows
 */
export function assertFiniteDurationIdleWindows(windows: readonly TimeWindow[]): void {
  for (const w of windows) {
    if (w.startMin === w.endMin) throw new Error(ZERO_DURATION_IDLE_WINDOW)
  }
}

/** Validate then merge — use when persisting a Save, and when evaluating deferral. */
export function resolveIdleWindows(windows: readonly TimeWindow[] | undefined): TimeWindow[] {
  return mergeIdleWindows(sanitizeIdleWindows(windows))
}

/**
 * Merge after rejecting zero-duration user windows.
 * Call from the Save/PATCH path only; runtime reads keep legacy equal-time = full day.
 *
 * @param windows - draft idle windows from the editor or API body
 * @returns merged windows
 */
export function resolveIdleWindowsForSave(windows: readonly TimeWindow[] | undefined): TimeWindow[] {
  const cleaned = sanitizeIdleWindows(windows)
  assertFiniteDurationIdleWindows(cleaned)
  return mergeIdleWindows(cleaned)
}

export function isDeepSeekPeak(date: Date = new Date()): boolean {
  const p = shanghaiParts(date)
  if (p.weekday === 0 || p.weekday === 6) return false
  const mins = p.hour * 60 + p.minute
  return DEEPSEEK_PEAK_WINDOWS.some(w => mins >= w.startMin && mins < w.endMin)
}

/**
 * Whether the agent should wait (not in an allowed 谷时 window).
 */
export function shouldDefer(date: Date, policy: Pick<SchedulePolicy, 'scheduleKind' | 'idleWindows'>): boolean {
  if (policy.scheduleKind === 'none') return false
  if (policy.scheduleKind !== 'custom') return isDeepSeekPeak(date)
  const windows = resolveIdleWindows(policy.idleWindows)
  const p = shanghaiParts(date)
  const mins = p.hour * 60 + p.minute
  return !windows.some(w => daysMatch(w.days, p.weekday) && inWindow(mins, w))
}

/** @deprecated use shouldDefer with deepseek policy */
export function isPeak(date: Date = new Date()): boolean {
  return isDeepSeekPeak(date)
}

/**
 * Next instant at or after `from` when the turn may run.
 * When deferred, returns the start of the next allowed clock minute.
 */
export function nextAllowedInstant(
  from: Date = new Date(),
  policy: Pick<SchedulePolicy, 'scheduleKind' | 'idleWindows'> = { scheduleKind: 'deepseek' },
): Date {
  if (!shouldDefer(from, policy)) return from
  let cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000)
  for (let step = 0; step < 8 * 24 * 60; step++) {
    if (!shouldDefer(cursor, policy)) return cursor
    cursor = new Date(cursor.getTime() + 60_000)
  }
  return cursor
}

/**
 * Next instant at or after `from` when work should leave the idle window
 * (`shouldDefer` becomes true). When already deferred, returns `from`.
 * When the schedule never defers (e.g. `none`, or always-idle), returns `null`.
 *
 * @param from - search start
 * @param policy - provider schedule
 * @returns first deferred minute, or `null` when none exists in the search horizon
 */
export function nextDeferInstant(
  from: Date = new Date(),
  policy: Pick<SchedulePolicy, 'scheduleKind' | 'idleWindows'> = { scheduleKind: 'deepseek' },
): Date | null {
  if (policy.scheduleKind === 'none') return null
  if (shouldDefer(from, policy)) return from
  let cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000)
  for (let step = 0; step < 8 * 24 * 60; step++) {
    cursor = new Date(cursor.getTime() + 60_000)
    if (shouldDefer(cursor, policy)) return cursor
  }
  return null
}

/** @deprecated prefer nextAllowedInstant */
export function nextOffpeakInstant(from: Date = new Date()): Date {
  return nextAllowedInstant(from, { scheduleKind: 'deepseek' })
}

export function formatWindow(w: TimeWindow): string {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60)
    const mm = m % 60
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const range = `${fmt(w.startMin)}–${fmt(w.endMin)}`
  const days = normalizeWindowDays(w.days)
  if (days === 'all') return range
  return `${days} ${range}`
}

export async function sleepUntil(until: Date, signal: AbortSignal): Promise<void> {
  while (Date.now() < until.getTime()) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
    }
    const wait = Math.min(15_000, Math.max(0, until.getTime() - Date.now()))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, wait)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
