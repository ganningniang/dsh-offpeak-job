/**
 * Unit checks for off-peak schedule helpers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isDeepSeekPeak,
  nextAllowedInstant,
  nextDeferInstant,
  shouldDefer,
  defaultKindForProvider,
  sanitizeIdleWindows,
  mergeIdleWindows,
  resolveIdleWindows,
  resolveIdleWindowsForSave,
  assertFiniteDurationIdleWindows,
  ZERO_DURATION_IDLE_WINDOW,
} from '../lib/offpeak-test-entry.js'

describe('DeepSeek default schedule', () => {
  it('defaults deepseek-official to deepseek kind', () => {
    assert.equal(defaultKindForProvider('deepseek-official'), 'deepseek')
    assert.equal(defaultKindForProvider('openai'), 'none')
  })

  it('treats weekday morning peak as defer', () => {
    const d = new Date('2026-09-10T02:00:00.000Z') // Thu 10:00 Shanghai
    assert.equal(isDeepSeekPeak(d), true)
    assert.equal(shouldDefer(d, { scheduleKind: 'deepseek' }), true)
  })

  it('treats weekday lunch gap as allowed', () => {
    const d = new Date('2026-09-10T04:30:00.000Z')
    assert.equal(shouldDefer(d, { scheduleKind: 'deepseek' }), false)
  })

  it('treats weekend as allowed', () => {
    const d = new Date('2026-09-12T02:00:00.000Z')
    assert.equal(shouldDefer(d, { scheduleKind: 'deepseek' }), false)
  })

  it('none never defers', () => {
    const d = new Date('2026-09-10T02:00:00.000Z')
    assert.equal(shouldDefer(d, { scheduleKind: 'none' }), false)
  })

  it('nextAllowedInstant snaps to window edge, not wall-clock seconds', () => {
    const from = new Date('2026-09-10T07:00:28.123Z')
    const next = nextAllowedInstant(from, { scheduleKind: 'deepseek' })
    assert.equal(next.toISOString(), '2026-09-10T10:00:00.000Z')
  })

  it('nextDeferInstant finds the next peak after an idle slot', () => {
    // Thu 12:30 Shanghai — lunch idle; next peak is 14:00 Shanghai.
    const lunch = new Date('2026-09-10T04:30:00.000Z')
    assert.equal(shouldDefer(lunch, { scheduleKind: 'deepseek' }), false)
    const next = nextDeferInstant(lunch, { scheduleKind: 'deepseek' })
    assert.equal(next?.toISOString(), '2026-09-10T06:00:00.000Z')
  })

  it('nextDeferInstant returns from when already deferred', () => {
    const peak = new Date('2026-09-10T02:00:00.000Z')
    const next = nextDeferInstant(peak, { scheduleKind: 'deepseek' })
    assert.equal(next?.toISOString(), peak.toISOString())
  })

  it('nextDeferInstant is null when schedule never defers', () => {
    assert.equal(nextDeferInstant(new Date(), { scheduleKind: 'none' }), null)
  })
})

describe('custom idle window', () => {
  it('allows inside overnight 谷时 18:00–09:00', () => {
    const evening = new Date('2026-09-10T12:00:00.000Z')
    assert.equal(shouldDefer(evening, {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 18 * 60, endMin: 9 * 60 }],
    }), false)
  })

  it('defers outside overnight 谷时', () => {
    const morningPeak = new Date('2026-09-10T02:00:00.000Z')
    assert.equal(shouldDefer(morningPeak, {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 18 * 60, endMin: 9 * 60 }],
    }), true)
  })

  it('supports multiple windows', () => {
    const morning = new Date('2026-09-10T02:00:00.000Z')
    assert.equal(shouldDefer(morning, {
      scheduleKind: 'custom',
      idleWindows: [
        { startMin: 9 * 60, endMin: 12 * 60 },
        { startMin: 22 * 60, endMin: 6 * 60 },
      ],
    }), false)
    const afternoon = new Date('2026-09-10T07:00:00.000Z')
    assert.equal(shouldDefer(afternoon, {
      scheduleKind: 'custom',
      idleWindows: [
        { startMin: 9 * 60, endMin: 12 * 60 },
        { startMin: 22 * 60, endMin: 6 * 60 },
      ],
    }), true)
  })

  it('respects weekdays vs weekends on the same clock time', () => {
    const thuMorning = new Date('2026-09-10T02:00:00.000Z') // Thu 10:00 Shanghai
    const satMorning = new Date('2026-09-12T02:00:00.000Z') // Sat 10:00 Shanghai
    const weekdaysOnly = {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 9 * 60, endMin: 12 * 60, days: 'weekdays' }],
    }
    assert.equal(shouldDefer(thuMorning, weekdaysOnly), false)
    assert.equal(shouldDefer(satMorning, weekdaysOnly), true)

    const weekendsOnly = {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 9 * 60, endMin: 12 * 60, days: 'weekends' }],
    }
    assert.equal(shouldDefer(thuMorning, weekendsOnly), true)
    assert.equal(shouldDefer(satMorning, weekendsOnly), false)
  })

  it('nextAllowedInstant can wait until the next matching day scope', () => {
    // Friday 10:00 Shanghai — weekdays window already past lunch; weekends cover Sat.
    const friMorning = new Date('2026-09-11T02:00:00.000Z')
    const next = nextAllowedInstant(friMorning, {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 9 * 60, endMin: 12 * 60, days: 'weekends' }],
    })
    assert.equal(next.toISOString(), '2026-09-12T01:00:00.000Z') // Sat 09:00 Shanghai
  })

  it('nextAllowedInstant leaves a deferred custom window at :00', () => {
    const inDay = new Date('2026-09-10T02:00:37.500Z')
    const next = nextAllowedInstant(inDay, {
      scheduleKind: 'custom',
      idleWindows: [{ startMin: 18 * 60, endMin: 9 * 60 }],
    })
    assert.equal(next.toISOString(), '2026-09-10T10:00:00.000Z')
  })

  it('sanitize keeps overlapping windows until Save/merge', () => {
    const kept = sanitizeIdleWindows([
      { startMin: 18 * 60, endMin: 9 * 60 },
      { startMin: 22 * 60, endMin: 9 * 60 },
    ])
    assert.equal(kept.length, 2)
    assert.equal(kept[0].days, 'all')
  })

  it('rejects zero-duration windows such as 09:00–09:00 on Save', () => {
    assert.throws(
      () => assertFiniteDurationIdleWindows([{ startMin: 9 * 60, endMin: 9 * 60 }]),
      (err) => err instanceof Error && err.message === ZERO_DURATION_IDLE_WINDOW,
    )
    assert.throws(
      () => resolveIdleWindowsForSave([{ startMin: 9 * 60, endMin: 9 * 60 }]),
      (err) => err instanceof Error && err.message === ZERO_DURATION_IDLE_WINDOW,
    )
  })

  it('merges overlapping overnight windows on resolve/Save', () => {
    const merged = resolveIdleWindows([
      { startMin: 18 * 60, endMin: 9 * 60 },
      { startMin: 22 * 60, endMin: 9 * 60 },
    ])
    assert.deepEqual(merged, [{ startMin: 18 * 60, endMin: 9 * 60, days: 'all' }])
  })

  it('does not merge weekday vs weekend scopes with each other', () => {
    assert.deepEqual(mergeIdleWindows([
      { startMin: 18 * 60, endMin: 9 * 60, days: 'weekdays' },
      { startMin: 18 * 60, endMin: 9 * 60, days: 'weekends' },
    ]), [
      { startMin: 18 * 60, endMin: 9 * 60, days: 'weekdays' },
      { startMin: 18 * 60, endMin: 9 * 60, days: 'weekends' },
    ])
  })

  it('drops weekday/weekend windows fully covered by every-day', () => {
    assert.deepEqual(mergeIdleWindows([
      { startMin: 18 * 60, endMin: 12 * 60, days: 'all' },
      { startMin: 22 * 60, endMin: 8 * 60, days: 'weekdays' },
    ]), [{ startMin: 18 * 60, endMin: 12 * 60, days: 'all' }])
  })

  it('trims weekday windows that only partially overlap every-day', () => {
    assert.deepEqual(mergeIdleWindows([
      { startMin: 18 * 60, endMin: 9 * 60, days: 'all' },
      { startMin: 8 * 60, endMin: 12 * 60, days: 'weekdays' },
    ]), [
      { startMin: 18 * 60, endMin: 9 * 60, days: 'all' },
      { startMin: 9 * 60, endMin: 12 * 60, days: 'weekdays' },
    ])
  })

  it('merges overlapping same-day windows', () => {
    assert.deepEqual(mergeIdleWindows([
      { startMin: 9 * 60, endMin: 12 * 60 },
      { startMin: 11 * 60, endMin: 14 * 60 },
    ]), [{ startMin: 9 * 60, endMin: 14 * 60, days: 'all' }])
  })

  it('keeps disjoint windows separate', () => {
    assert.deepEqual(mergeIdleWindows([
      { startMin: 9 * 60, endMin: 12 * 60 },
      { startMin: 22 * 60, endMin: 6 * 60 },
    ]), [
      { startMin: 9 * 60, endMin: 12 * 60, days: 'all' },
      { startMin: 22 * 60, endMin: 6 * 60, days: 'all' },
    ])
  })
})
