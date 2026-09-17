/**
 * tool-jobs completion notice detection for off-peak park routing.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isJobCompletionNotice } from '../lib/job-notice-test-entry.js'

describe('isJobCompletionNotice', () => {
  it('matches tool-jobs completion notices', () => {
    assert.equal(isJobCompletionNotice({
      role: 'user',
      content: [{ type: 'text', text: 'background job bash-2 finished' }],
      source: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'bash' },
    }), true)
  })

  it('rejects user prompts and other plugin forms', () => {
    assert.equal(isJobCompletionNotice({
      source: { kind: 'user', rpcId: 'req-1' },
    }), false)
    assert.equal(isJobCompletionNotice({
      source: { kind: 'plugin', plugin: 'tool-jobs', form: 'relay' },
    }), false)
    assert.equal(isJobCompletionNotice(null), false)
  })
})
