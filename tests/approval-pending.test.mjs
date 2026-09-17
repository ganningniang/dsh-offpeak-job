/**
 * ApprovalPendingTracker: unmatched approval/asked vs decided.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalPendingTracker } from '../lib/approval-pending-test-entry.js'

describe('ApprovalPendingTracker', () => {
  it('tracks asked until decided; clears on turn/end', () => {
    const tracker = new ApprovalPendingTracker()
    tracker.onEvent('s1', { type: 'approval/asked', data: { id: 'a1' } })
    assert.equal(tracker.hasPending('s1'), true)
    tracker.onEvent('s1', { type: 'approval/asked', data: { id: 'a2' } })
    assert.deepEqual(tracker.pendingSessionIds(), ['s1'])
    tracker.onEvent('s1', { type: 'approval/decided', data: { id: 'a1' } })
    assert.equal(tracker.hasPending('s1'), true)
    tracker.onEvent('s1', { type: 'approval/decided', data: { id: 'a2' } })
    assert.equal(tracker.hasPending('s1'), false)

    tracker.onEvent('s2', { type: 'approval/asked', data: { id: 'b1' } })
    tracker.onEvent('s2', { type: 'turn/end' })
    assert.equal(tracker.hasPending('s2'), false)
  })

  it('seedFromEvents folds a snapshot', () => {
    const tracker = new ApprovalPendingTracker()
    tracker.seedFromEvents('s1', [
      { type: 'approval/asked', data: { id: 'x' } },
      { type: 'approval/asked', data: { id: 'y' } },
      { type: 'approval/decided', data: { id: 'x' } },
    ])
    assert.equal(tracker.hasPending('s1'), true)
    tracker.seedFromEvents('s1', [
      { type: 'approval/asked', data: { id: 'x' } },
      { type: 'approval/decided', data: { id: 'x' } },
    ])
    assert.equal(tracker.hasPending('s1'), false)
  })
})
