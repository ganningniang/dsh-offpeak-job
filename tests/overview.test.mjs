/**
 * Cross-session overview builder checks.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildOverview } from '../lib/overview-test-entry.js'
import { SessionConfigStore } from '../lib/session-store-test-entry.js'
import { ProviderScheduleStore } from '../lib/provider-store-test-entry.js'
import { WaitStateStore } from '../lib/wait-state-test-entry.js'

describe('buildOverview', () => {
  it('lists only Off-peak-enabled sessions; badges waiting/resume; idle is listed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      const until = new Date('2026-09-16T02:00:00.000Z')

      providers.set('deepseek-official', {
        scheduleKind: 'deepseek',
        defaultApprovalPolicy: 'wait',
      })
      sessions.set('s-wait', { enabled: true })
      sessions.set('s-idle', { enabled: true })
      sessions.set('s-off', { enabled: false })
      sessions.set('s-resume', { enabled: true })

      waits.enqueue('s-wait', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'parked hello' }],
      }, until, 'deepseek-official', 'user')
      waits.enqueue('s-resume', {
        id: 'm2',
        role: 'user',
        content: [{ type: 'text', text: 'resume me' }],
      }, until, 'deepseek-official', 'resume')
      // Disabled session with a park must not appear.
      waits.enqueue('s-off', {
        id: 'm3',
        role: 'user',
        content: [{ type: 'text', text: 'ignored' }],
      }, until, 'deepseek-official', 'user')

      const live = {
        's-idle': { status: 'idle', providerId: 'deepseek-official' },
        's-wait': { status: 'idle', providerId: 'deepseek-official' },
        's-resume': { status: 'idle', providerId: 'deepseek-official' },
      }
      const overview = buildOverview(sessions, providers, waits, {
        agentOf: (id) => live[id],
      })

      assert.equal(overview.entryVisible, true)
      assert.equal(overview.badgeCount, 2)
      const byId = Object.fromEntries(overview.sessions.map(row => [row.sessionId, row]))
      assert.equal(byId['s-wait']?.status, 'waiting')
      assert.equal(byId['s-wait']?.windowWait, true)
      assert.equal(byId['s-resume']?.status, 'resume')
      assert.equal(byId['s-idle']?.status, 'idle')
      assert.equal(byId['s-off'], undefined)
      assert.equal(byId['s-wait']?.textPreview, 'parked hello')
      assert.equal(byId['s-wait']?.parkedUser, 1)
      // Provider policy, not session field.
      assert.equal(byId['s-idle']?.approvalPolicy, 'wait')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts idle soft+inbox mirrors as parkedUser (not inbox-id-only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-mirror-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      const until = new Date('2026-09-16T04:00:00.000Z')
      sessions.set('s1', { enabled: true })
      const row = waits.enqueue('s1', {
        id: 'msg-1',
        role: 'user',
        content: [{ type: 'text', text: 'idle mirror' }],
      }, until, 'deepseek-official', 'user')
      waits.bindInboxMessageId('s1', row.id, 'msg-1')
      const overview = buildOverview(sessions, providers, waits, {
        agentOf: () => ({ status: 'idle', providerId: 'deepseek-official' }),
      })
      assert.equal(overview.sessions[0]?.status, 'waiting')
      assert.equal(overview.sessions[0]?.parkedUser, 1)
      assert.equal(overview.sessions[0]?.textPreview, 'idle mirror')
      assert.equal(overview.sessions[0]?.windowWait, true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hides the sidebar entry when every provider turns peak/off-peak off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-hide-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      providers.set('deepseek-official', {
        scheduleKind: 'none',
        chipVisible: false,
      })
      sessions.set('s1', { enabled: true })
      const overview = buildOverview(sessions, providers, waits, {
        agentOf: () => ({ status: 'idle', providerId: 'deepseek-official' }),
      })
      assert.equal(overview.entryVisible, false)
      assert.equal(overview.badgeCount, 0)
      assert.equal(overview.sessions.length, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('marks durable waits without a live agent as orphan and badges them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-orphan-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      const until = new Date('2026-09-16T03:00:00.000Z')

      sessions.set('s-gone', { enabled: true })
      waits.enqueue('s-gone', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'orphaned park' }],
      }, until, 'deepseek-official', 'user')

      const overview = buildOverview(sessions, providers, waits, {
        agentOf: () => undefined,
      })
      assert.equal(overview.badgeCount, 1)
      assert.equal(overview.sessions[0]?.status, 'orphan')
      assert.equal(overview.sessions[0]?.orphan, true)
      assert.equal(overview.sessions[0]?.textPreview, 'orphaned park')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('badges pending approval ahead of running', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-appr-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      sessions.set('s1', { enabled: true })
      const overview = buildOverview(sessions, providers, waits, {
        agentOf: () => ({ status: 'running', providerId: 'deepseek-official' }),
        hasApprovalPending: (id) => id === 's1',
      })
      assert.equal(overview.sessions[0]?.status, 'approval')
      assert.equal(overview.badgeCount, 1)
      assert.equal(overview.sessions[0]?.windowWait, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores session approvalPolicy; uses provider default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-ov-pol-'))
    try {
      const sessions = new SessionConfigStore(join(dir, 'sessions.json'))
      const providers = new ProviderScheduleStore(join(dir, 'providers.json'))
      const waits = new WaitStateStore(join(dir, 'waits.json'))
      providers.set('deepseek-official', { defaultApprovalPolicy: 'allow' })
      sessions.set('s1', { enabled: true, approvalPolicy: 'reject' })
      const overview = buildOverview(sessions, providers, waits, {
        agentOf: () => ({ status: 'idle', providerId: 'deepseek-official' }),
      })
      assert.equal(overview.sessions[0]?.approvalPolicy, 'allow')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
