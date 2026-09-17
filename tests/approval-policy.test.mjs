/**
 * Unit checks for off-peak approval policy helpers (provider-owned).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_OFFPEAK_APPROVAL_POLICY,
  parseOffpeakApprovalPolicy,
  resolveOffpeakApprovalPolicy,
} from '../lib/approval-policy-test-entry.js'
import { decideOffpeakApproval } from '../lib/approval-test-entry.js'
import { ProviderScheduleStore } from '../lib/provider-store-test-entry.js'

describe('offpeak approval policy', () => {
  it('defaults to reject', () => {
    assert.equal(DEFAULT_OFFPEAK_APPROVAL_POLICY, 'reject')
    assert.equal(resolveOffpeakApprovalPolicy(undefined), 'reject')
    assert.equal(resolveOffpeakApprovalPolicy('nope'), 'reject')
  })

  it('parses the closed three-state vocabulary', () => {
    assert.equal(parseOffpeakApprovalPolicy('reject'), 'reject')
    assert.equal(parseOffpeakApprovalPolicy('wait'), 'wait')
    assert.equal(parseOffpeakApprovalPolicy('allow'), 'allow')
    assert.equal(parseOffpeakApprovalPolicy('ask'), undefined)
  })

  it('Run now (enabled=false) always delegates; Off-peak applies three states', () => {
    assert.equal(decideOffpeakApproval(false, 'reject'), 'delegate')
    assert.equal(decideOffpeakApproval(false, 'allow'), 'delegate')
    assert.equal(decideOffpeakApproval(true, 'reject'), 'rejected')
    assert.equal(decideOffpeakApproval(true, 'allow'), 'allowed-once')
    assert.equal(decideOffpeakApproval(true, 'wait'), 'delegate')
  })

  it('provider defaultApprovalPolicy is the runtime authority', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-prov-pol-'))
    try {
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      providers.set('p1', {
        scheduleKind: 'custom',
        idleWindows: [{ startMin: 0, endMin: 60 }],
        defaultApprovalPolicy: 'wait',
      })
      assert.equal(providers.get('p1').defaultApprovalPolicy, 'wait')
      providers.set('p1', { defaultApprovalPolicy: 'allow' })
      assert.equal(providers.get('p1').defaultApprovalPolicy, 'allow')
      assert.equal(
        resolveOffpeakApprovalPolicy(providers.get('p1').defaultApprovalPolicy),
        'allow',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
