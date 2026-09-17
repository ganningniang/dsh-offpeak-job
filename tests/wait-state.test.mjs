/**
 * Durable WaitStateStore: waits.json round-trip across Host restart.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WaitStateStore } from '../lib/wait-state-test-entry.js'

function userMessage(text) {
  return {
    id: `msg-${text}`,
    role: 'user',
    content: [{ type: 'text', text }],
  }
}

describe('WaitStateStore persistence', () => {
  it('rehydrates soft parks, resume, and inbox ids from waits.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-waits-'))
    const path = join(dir, 'waits.json')
    try {
      const until = new Date('2026-09-15T10:00:00.000Z')
      const first = new WaitStateStore(path)
      first.enqueue('sess-a', userMessage('hello'), until, 'deepseek-official', 'user')
      first.enqueue('sess-a', {
        id: 'resume-1',
        role: 'user',
        content: [{ type: 'text', text: 'continue please' }],
        source: { kind: 'plugin', plugin: 'dsh-offpeak-job', form: 'notice' },
      }, until, 'deepseek-official', 'resume')
      first.setInboxMessageIds('sess-a', ['inbox-1', 'inbox-2'])
      first.setSendConflict('sess-a', true)

      const raw = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(raw.version, 1)
      assert.equal(raw.sessions['sess-a'].parks.length, 2)
      assert.deepEqual(raw.sessions['sess-a'].inboxMessageIds, ['inbox-1', 'inbox-2'])
      assert.equal(raw.sessions['sess-a'].sendConflict, true)

      const second = new WaitStateStore(path)
      assert.equal(second.hasParked('sess-a'), true)
      assert.equal(second.hasResume('sess-a'), true)
      assert.equal(second.hasSendConflict('sess-a'), true)
      assert.deepEqual([...second.inboxMessageIds('sess-a')], ['inbox-1', 'inbox-2'])
      const parks = second.list('sess-a')
      assert.equal(parks.length, 2)
      assert.equal(parks[0].kind, 'user')
      assert.equal(parks[0].textPreview, 'hello')
      assert.equal(parks[1].kind, 'resume')
      assert.equal(second.get('sess-a')?.providerId, 'deepseek-official')
      assert.equal(second.get('sess-a')?.waitingUntil, until.toISOString())

      // New enqueue continues seq after restore.
      const row = second.enqueue('sess-a', userMessage('again'), until, 'deepseek-official')
      assert.match(row.id, /^park-\d+$/)
      const seq = Number(row.id.slice('park-'.length))
      assert.ok(seq >= 3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists idle soft park payload with inboxMessageId across reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-waits-mirror-'))
    const path = join(dir, 'waits.json')
    try {
      const until = new Date('2026-09-15T11:00:00.000Z')
      const first = new WaitStateStore(path)
      const row = first.enqueue(
        'sess-m',
        userMessage('mirrored'),
        until,
        'deepseek-official',
        'user',
      )
      assert.equal(first.bindInboxMessageId('sess-m', row.id, 'inbox-live-1'), true)
      assert.deepEqual([...first.mirroredInboxIds('sess-m')], ['inbox-live-1'])
      assert.deepEqual([...first.inboxMessageIds('sess-m')], ['inbox-live-1'])

      const raw = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(raw.sessions['sess-m'].parks.length, 1)
      assert.equal(raw.sessions['sess-m'].parks[0].textPreview, 'mirrored')
      assert.equal(raw.sessions['sess-m'].parks[0].inboxMessageId, 'inbox-live-1')
      assert.deepEqual(raw.sessions['sess-m'].inboxMessageIds, ['inbox-live-1'])

      const second = new WaitStateStore(path)
      assert.equal(second.hasParked('sess-m'), true)
      assert.equal(second.list('sess-m')[0]?.inboxMessageId, 'inbox-live-1')
      assert.equal(second.list('sess-m')[0]?.textPreview, 'mirrored')
      assert.deepEqual([...second.mirroredInboxIds('sess-m')], ['inbox-live-1'])

      const removed = second.takeByInboxMessageId('sess-m', 'inbox-live-1')
      assert.equal(removed?.textPreview, 'mirrored')
      assert.equal(second.hasParked('sess-m'), false)
      assert.deepEqual([...second.mirroredInboxIds('sess-m')], [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('takeAll clears the durable file entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-waits-'))
    const path = join(dir, 'waits.json')
    try {
      const until = new Date('2026-09-15T12:00:00.000Z')
      const store = new WaitStateStore(path)
      store.enqueue('sess-b', userMessage('bye'), until, 'p1')
      assert.equal(store.takeAll('sess-b').length, 1)
      const again = new WaitStateStore(path)
      assert.equal(again.hasParked('sess-b'), false)
      assert.equal(again.get('sess-b'), undefined)
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      assert.equal(raw.sessions['sess-b'], undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips non-JSON message payloads without losing other parks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opj-waits-'))
    const path = join(dir, 'waits.json')
    try {
      const until = new Date('2026-09-15T13:00:00.000Z')
      const skipped = []
      const store = new WaitStateStore(path, (detail) => { skipped.push(detail) })
      const cyclic = { id: 'bad' }
      cyclic.self = cyclic
      store.enqueue('sess-c', cyclic, until, 'p1')
      store.enqueue('sess-c', userMessage('ok'), until, 'p1')
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      // Cyclic row dropped on persist; good row kept.
      assert.equal(raw.sessions['sess-c'].parks.length, 1)
      assert.equal(raw.sessions['sess-c'].parks[0].textPreview, 'ok')
      assert.ok(skipped.length >= 1)
      assert.equal(skipped[0].reason, 'non-json')
      assert.equal(skipped[0].sessionId, 'sess-c')
      assert.ok(skipped.every(row => row.reason === 'non-json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
