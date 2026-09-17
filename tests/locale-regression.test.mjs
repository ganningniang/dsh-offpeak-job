/**
 * Frozen chip / WaitDock / resume-conflict / window-end copy — additive locales only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Locales ship as TS source; build folds them into client.js. Snapshot the source strings.
const src = readFileSync(join(here, '../src/client/locales.ts'), 'utf8')

/** Keys that must keep their Chinese and English product copy unchanged. */
const FROZEN = {
  zh: {
    chipImmediate: '立即运行',
    chipOffpeak: '谷时运行',
    waitDockTitle: '等待谷时',
    waitDockRunNow: '现在开始',
    waitDockCancel: '放弃待发',
    waitDockResumeTitle: '谷时暂停',
    waitDockResumeRunNow: '现在开始',
    waitDockResumeCancel: '放弃续跑',
    resumeConflictTitle: '当前还有待续跑的任务',
    resumeConflictKeep: '先完成待续任务',
    resumeConflictDiscard: '丢弃待续',
    windowEndTitle: '谷时窗口结束时',
    windowEndContinue: '继续运行',
    windowEndPause: '进入峰时暂停，下一段谷时继续',
    providerFold: '峰谷设置',
    chipVisible: '启用峰谷',
  },
  en: {
    chipImmediate: 'Run now',
    chipOffpeak: 'Off-peak run',
    waitDockTitle: 'Waiting for off-peak',
    waitDockRunNow: 'Start now',
    waitDockCancel: 'Discard pending',
    waitDockResumeTitle: 'Paused for peak hours',
    waitDockResumeRunNow: 'Start now',
    waitDockResumeCancel: 'Discard resume',
    resumeConflictTitle: 'A paused task is waiting to resume',
    resumeConflictKeep: 'Keep resume first',
    resumeConflictDiscard: 'Discard resume',
    windowEndTitle: 'When the off-peak window ends',
    windowEndContinue: 'Keep running',
    windowEndPause: 'Pause when peak begins, resume next off-peak',
    providerFold: 'Peak / off-peak',
    chipVisible: 'Enable off-peak',
  },
}

function extractBlock(label) {
  const re = new RegExp(`export const ${label}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`)
  const m = src.match(re)
  assert.ok(m, `missing ${label} locale object`)
  return m[1]
}

function valueOf(block, key) {
  const re = new RegExp(`${key}:\\s*'((?:\\\\'|[^'])*)'`)
  const m = block.match(re)
  assert.ok(m, `missing key ${key}`)
  return m[1].replace(/\\'/g, "'")
}

describe('locale regression (additive only)', () => {
  it('keeps legacy chip / WaitDock / conflict / peak strings', () => {
    const zhBlock = extractBlock('zh')
    const enBlock = extractBlock('en')
    for (const [key, expected] of Object.entries(FROZEN.zh)) {
      assert.equal(valueOf(zhBlock, key), expected, `zh.${key}`)
    }
    for (const [key, expected] of Object.entries(FROZEN.en)) {
      assert.equal(valueOf(enBlock, key), expected, `en.${key}`)
    }
  })

  it('includes new overview orphan / approval / 谷时总览 keys', () => {
    assert.match(src, /overviewStatusOrphan:/)
    assert.match(src, /overviewStatusApproval:/)
    assert.match(src, /overviewStatusIdle:/)
    assert.match(src, /overviewFilterActive:/)
    assert.match(src, /overviewTrigger: '谷时总览'/)
    assert.match(src, /approvalPolicyTitle: '谷时运行提权审批策略'/)
  })
})
