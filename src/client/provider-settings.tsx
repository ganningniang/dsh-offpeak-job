/**
 * Provider-card peak/off-peak editor: same visual language as Models ProviderEditor
 * (title + module fill + fields + Cancel/Save). Visible only while the row editor is open.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { mergeIdleWindows, shouldDefer } from '../offpeak.ts'
import { emitOffpeakProviderConfigChange } from './config-events.ts'
import { zh, en, type OffpeakKey } from './locales.ts'

type ScheduleKind = 'deepseek' | 'custom' | 'none'
type WindowDays = 'all' | 'weekdays' | 'weekends'
type WindowEndPolicy = 'continue' | 'pause'
type OffpeakApprovalPolicy = 'reject' | 'wait' | 'allow'

interface TimeWindow {
  startMin: number
  endMin: number
  days: WindowDays
}

interface ProviderPayload {
  providerId: string
  config: {
    scheduleKind: ScheduleKind
    idleWindows?: Array<{ startMin: number; endMin: number; days?: WindowDays }>
    chipVisible?: boolean
    windowEndPolicy?: WindowEndPolicy
    defaultApprovalPolicy?: OffpeakApprovalPolicy
  }
  chipVisible?: boolean
  isDeepSeekOfficial: boolean
  defaultCustomIdle?: { startMin: number; endMin: number; days?: WindowDays }
  summary?: string
  /** Sessions currently parked for this provider's idle windows. */
  waitingCount?: number
  /** Messages flushed when Save turned the peak feature off. */
  released?: number
}

interface DraftSnapshot {
  kind: ScheduleKind
  windows: TimeWindow[]
  isDeepSeek: boolean
  chipVisible: boolean
  windowEndPolicy: WindowEndPolicy
  defaultApprovalPolicy: OffpeakApprovalPolicy
}

const STYLE_ID = 'dsh-opj-provider-settings-css-v10'
const STYLES = `/* Sit after ProviderEditor in the card flex column (slot DOM is above it). */
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
`

function ensureStyles(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (el === null) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = STYLES
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
  }
  return body as T
}

function translate(t: ((key: OffpeakKey) => string) | undefined, key: OffpeakKey): string {
  const fromProp = t?.(key)
  if (typeof fromProp === 'string' && fromProp.trim() !== '') return fromProp
  return zh[key] ?? en[key] ?? key
}

function minToTimeValue(min: number): string {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function timeValueToMin(value: string): number {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return Math.min(23 * 60 + 59, Math.max(0, h * 60 + m))
}

function normalizeDays(days: unknown): WindowDays {
  return days === 'weekdays' || days === 'weekends' ? days : 'all'
}

function asWindow(w: { startMin: number; endMin: number; days?: WindowDays }): TimeWindow {
  return { startMin: w.startMin, endMin: w.endMin, days: normalizeDays(w.days) }
}

function cloneWindows(windows: TimeWindow[]): TimeWindow[] {
  return windows.map(w => ({ ...w }))
}

function windowKey(w: { startMin: number; endMin: number; days?: WindowDays }): string {
  return `${normalizeDays(w.days)}:${w.startMin}-${w.endMin}`
}

/** True when Save would merge/trim these draft windows into a different set. */
function draftWindowsOverlap(windows: TimeWindow[]): boolean {
  const finite = windows.filter(w => w.startMin !== w.endMin)
  if (finite.length < 2) return false
  const merged = mergeIdleWindows(finite)
  if (merged.length !== finite.length) return true
  const before = new Set(finite.map(windowKey))
  const after = new Set(merged.map(windowKey))
  if (before.size !== after.size) return true
  for (const key of before) {
    if (!after.has(key)) return true
  }
  return false
}

function editorOpenAround(host: HTMLElement): boolean {
  const row = host.closest('li') ?? host.parentElement
  if (row === null) return true
  for (const input of row.querySelectorAll('input, select, textarea')) {
    if (!host.contains(input)) return true
  }
  return false
}

function asApprovalPolicy(value: unknown): OffpeakApprovalPolicy {
  return value === 'wait' || value === 'allow' ? value : 'reject'
}

function draftFromPayload(data: ProviderPayload): DraftSnapshot {
  const kind = data.config.scheduleKind
  const windows = data.config.idleWindows?.length
    ? data.config.idleWindows.map(asWindow)
    : [asWindow(data.defaultCustomIdle ?? { startMin: 18 * 60, endMin: 9 * 60, days: 'all' })]
  // Legacy `none` means the feature is off; the panel toggle replaces that option.
  const storedChip = data.chipVisible ?? data.config.chipVisible !== false
  const chipVisible = kind !== 'none' && storedChip
  const windowEndPolicy = data.config.windowEndPolicy === 'pause' ? 'pause' : 'continue'
  const defaultApprovalPolicy = asApprovalPolicy(data.config.defaultApprovalPolicy)
  return {
    kind,
    windows,
    isDeepSeek: data.isDeepSeekOfficial,
    chipVisible,
    windowEndPolicy,
    defaultApprovalPolicy,
  }
}

export function ProviderPeakSettings(props: {
  providerId: string
  t?: (key: OffpeakKey) => string
}) {
  ensureStyles()
  const t = (key: OffpeakKey) => translate(props.t, key)
  const hostRef = useRef<HTMLDivElement>(null)
  const baselineRef = useRef<DraftSnapshot | null>(null)
  const flushConfirmedRef = useRef(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [kind, setKind] = useState<ScheduleKind>('none')
  const [windows, setWindows] = useState<TimeWindow[]>([
    { startMin: 18 * 60, endMin: 9 * 60, days: 'all' },
  ])
  const [isDeepSeek, setIsDeepSeek] = useState(false)
  const [chipVisible, setChipVisible] = useState(true)
  const [windowEndPolicy, setWindowEndPolicy] = useState<WindowEndPolicy>('continue')
  const [defaultApprovalPolicy, setDefaultApprovalPolicy] = useState<OffpeakApprovalPolicy>('reject')
  const [waitingCount, setWaitingCount] = useState(0)
  const [flushDialogOpen, setFlushDialogOpen] = useState(false)
  const [flushDialogKind, setFlushDialogKind] = useState<'chip-off' | 'schedule'>('chip-off')
  const [allowConfirmOpen, setAllowConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sameTimeSaveError, setSameTimeSaveError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const sync = () => { setEditorOpen(editorOpenAround(host)) }
    sync()
    const row = host.closest('li') ?? host.parentElement
    if (row === null) return
    const mo = new MutationObserver(sync)
    mo.observe(row, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  const applyDraft = (draft: DraftSnapshot) => {
    setKind(draft.kind)
    setWindows(cloneWindows(draft.windows))
    setIsDeepSeek(draft.isDeepSeek)
    setChipVisible(draft.chipVisible)
    setWindowEndPolicy(draft.windowEndPolicy)
    setDefaultApprovalPolicy(draft.defaultApprovalPolicy)
  }

  const applyPayload = (data: ProviderPayload) => {
    const draft = draftFromPayload(data)
    baselineRef.current = draft
    applyDraft(draft)
    setWaitingCount(typeof data.waitingCount === 'number' ? data.waitingCount : 0)
    setError(null)
    setSameTimeSaveError(false)
    setLoaded(true)
  }

  const refresh = useCallback(async () => {
    try {
      const data = await api<ProviderPayload>(
        `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`,
      )
      applyPayload(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadError'))
    }
  }, [props.providerId])

  useEffect(() => {
    if (!editorOpen) return
    void refresh()
  }, [editorOpen, refresh])

  const cancel = () => {
    const baseline = baselineRef.current
    if (baseline === null) return
    applyDraft(baseline)
    setError(null)
    setSameTimeSaveError(false)
    setSavedFlash(false)
    setFlushDialogOpen(false)
    flushConfirmedRef.current = false
    setAllowConfirmOpen(false)
  }

  const save = async () => {
    if (saving || !loaded) return
    setSavedFlash(false)
    setError(null)
    setSameTimeSaveError(false)
    const effectiveKind: ScheduleKind = chipVisible
      ? (kind === 'none' ? (isDeepSeek ? 'deepseek' : 'custom') : kind)
      : (kind === 'none' ? 'none' : kind)
    if (chipVisible && effectiveKind === 'custom'
      && windows.some(w => w.startMin === w.endMin)) {
      // Promote the existing grey hint to red; do not add a second error line.
      setSameTimeSaveError(true)
      return
    }

    // Confirm on Save when parked work would start running (chip off, or
    // new windows make "now" an idle slot).
    const turningOff = !chipVisible
    const draftRunsNow = turningOff || !shouldDefer(new Date(), {
      scheduleKind: effectiveKind,
      idleWindows: effectiveKind === 'custom' ? windows : undefined,
    })
    if (!flushConfirmedRef.current && draftRunsNow) {
      try {
        const live = await api<ProviderPayload>(
          `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`,
        )
        const count = typeof live.waitingCount === 'number' ? live.waitingCount : 0
        setWaitingCount(count)
        if (count > 0) {
          setFlushDialogKind(turningOff ? 'chip-off' : 'schedule')
          setFlushDialogOpen(true)
          return
        }
      } catch {
        if (waitingCount > 0) {
          setFlushDialogKind(turningOff ? 'chip-off' : 'schedule')
          setFlushDialogOpen(true)
          return
        }
      }
    }
    flushConfirmedRef.current = false

    setSaving(true)
    try {
      // Host validates zero-duration ranges and merges overlaps.
      const idleWindows = chipVisible && effectiveKind === 'custom' ? windows : undefined
      const data = await api<ProviderPayload>(
        `/api/offpeak-job/provider/${encodeURIComponent(props.providerId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            scheduleKind: effectiveKind,
            chipVisible,
            windowEndPolicy,
            defaultApprovalPolicy,
            ...(idleWindows !== undefined ? { idleWindows } : {}),
          }),
        },
      )
      applyPayload(data)
      setSavedFlash(true)
      emitOffpeakProviderConfigChange()
      window.setTimeout(() => setSavedFlash(false), 1500)
    } catch (e) {
      const message = e instanceof Error ? e.message : t('saveError')
      // Host may still reject zero-duration; mirror the inline hint, not a long error.
      if (message.includes('start and end must differ')) {
        setSameTimeSaveError(true)
      } else {
        setError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const setFeatureOn = (on: boolean) => {
    setChipVisible(on)
    if (on && kind === 'none') setKind(isDeepSeek ? 'deepseek' : 'custom')
  }

  const confirmFlushSave = () => {
    flushConfirmedRef.current = true
    setFlushDialogOpen(false)
    void save()
  }

  const cancelFlushSave = () => {
    flushConfirmedRef.current = false
    setFlushDialogOpen(false)
  }

  const showCustom = kind === 'custom' || (chipVisible && !isDeepSeek && kind !== 'deepseek')
  const hasOvernight = windows.some(w => w.startMin > w.endMin)
  const hasSameTime = windows.some(w => w.startMin === w.endMin)
  const hasScopedDays = windows.some(w => w.days !== 'all')
  const hasOverlap = draftWindowsOverlap(windows)

  useEffect(() => {
    if (!hasSameTime) setSameTimeSaveError(false)
  }, [hasSameTime])

  return (
    <div
      ref={hostRef}
      className="dsh-opj_providerSeat"
      {...(editorOpen ? { 'data-open': '' } : {})}
    >
      {!editorOpen ? null : (
        <div className="dsh-opj_panel">
          <div className="dsh-opj_panelHeader">
            <span className="dsh-opj_panelTitle">{t('providerFold')}</span>
            <label className="dsh-opj_toggle">
              <input
                className="dsh-opj_toggleInput"
                type="checkbox"
                role="switch"
                checked={chipVisible}
                disabled={saving || !loaded}
                aria-label={t('chipVisible')}
                onChange={e => { setFeatureOn(e.target.checked) }}
              />
              <span className="dsh-opj_toggleTrack" aria-hidden>
                <span className="dsh-opj_toggleThumb" />
              </span>
            </label>
          </div>

          <Modal
            open={flushDialogOpen}
            onClose={cancelFlushSave}
            title={t(flushDialogKind === 'chip-off' ? 'chipOffFlushTitle' : 'scheduleFlushTitle')}
            closeLabel={t('chipOffFlushClose')}
            description={t('chipOffFlushHint')}
            footer={(
              <>
                <Button variant="outline" onClick={cancelFlushSave}>
                  {t('chipOffFlushCancel')}
                </Button>
                <Button variant="primary" autoFocus onClick={confirmFlushSave}>
                  {t('chipOffFlushConfirm')}
                </Button>
              </>
            )}
          />

          {!loaded && !error ? null : (
            <>
              {chipVisible && (
                <>
                  <p className="dsh-opj_hint">{t('providerFoldHint')}</p>

                  {isDeepSeek && (
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-prov-${props.providerId}`}
                          checked={kind === 'deepseek'}
                          disabled={saving}
                          onChange={() => { setKind('deepseek') }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('kindDeepseek')}</span>
                          <span className="dsh-opj_hint">{t('kindDeepseekHint')}</span>
                        </span>
                      </span>
                    </label>
                  )}

                  <label className="dsh-opj_field">
                    <span className="dsh-opj_fieldLabel">
                      <input
                        type="radio"
                        name={`opj-prov-${props.providerId}`}
                        checked={showCustom}
                        disabled={saving}
                        onChange={() => { setKind('custom') }}
                      />
                      <span className="dsh-opj_radioTitle">{t('kindCustom')}</span>
                    </span>
                  </label>

                  {showCustom && (
                    <div className="dsh-opj_field" style={{ paddingLeft: 22 }}>
                      {windows.map((w, index) => (
                        <div key={index} className="dsh-opj_windowRow">
                          <select
                            className="dsh-opj_select"
                            aria-label={t('daysLabel')}
                            value={w.days}
                            disabled={saving}
                            onChange={e => {
                              const days = normalizeDays(e.target.value)
                              setWindows(list => list.map((row, i) => (
                                i === index ? { ...row, days } : row
                              )))
                            }}
                          >
                            <option value="all">{t('daysAll')}</option>
                            <option value="weekdays">{t('daysWeekdays')}</option>
                            <option value="weekends">{t('daysWeekends')}</option>
                          </select>
                          <span className="dsh-opj_hint">{t('idleFrom')}</span>
                          <input
                            type="time"
                            className="dsh-opj_input"
                            value={minToTimeValue(w.startMin)}
                            disabled={saving}
                            onChange={e => {
                              setWindows(list => list.map((row, i) => (
                                i === index
                                  ? { startMin: timeValueToMin(e.target.value), endMin: row.endMin, days: row.days }
                                  : row
                              )))
                            }}
                          />
                          <span className="dsh-opj_hint">{t('idleTo')}</span>
                          <input
                            type="time"
                            className="dsh-opj_input"
                            value={minToTimeValue(w.endMin)}
                            disabled={saving}
                            onChange={e => {
                              setWindows(list => list.map((row, i) => (
                                i === index
                                  ? { startMin: row.startMin, endMin: timeValueToMin(e.target.value), days: row.days }
                                  : row
                              )))
                            }}
                          />
                          {windows.length > 1 && (
                            <button
                              type="button"
                              className="dsh-opj_textButton"
                              disabled={saving}
                              onClick={() => {
                                setWindows(list => list.filter((_, i) => i !== index))
                              }}
                            >
                              {t('removeWindow')}
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="dsh-opj_textButton"
                        style={{ alignSelf: 'flex-start' }}
                        disabled={saving}
                        onClick={() => {
                          setWindows(list => [
                            ...list,
                            { startMin: 22 * 60, endMin: 8 * 60, days: 'all' },
                          ])
                        }}
                      >
                        {t('addWindow')}
                      </button>
                      {hasOvernight && <p className="dsh-opj_hint">{t('overnightHint')}</p>}
                      {hasSameTime && (
                        <p
                          className={
                            sameTimeSaveError
                              ? 'dsh-opj_hint dsh-opj_hintError'
                              : 'dsh-opj_hint'
                          }
                        >
                          {t('windowSameTimeHint')}
                        </p>
                      )}
                      {hasScopedDays && <p className="dsh-opj_hint">{t('daysScopeHint')}</p>}
                      {hasOverlap && <p className="dsh-opj_hint">{t('overlapHint')}</p>}
                    </div>
                  )}

                  <div className="dsh-opj_field">
                    <span className="dsh-opj_radioTitle">{t('windowEndTitle')}</span>
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-wend-${props.providerId}`}
                          checked={windowEndPolicy === 'continue'}
                          disabled={saving}
                          onChange={() => { setWindowEndPolicy('continue') }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('windowEndContinue')}</span>
                          <span className="dsh-opj_hint">{t('windowEndContinueHint')}</span>
                        </span>
                      </span>
                    </label>
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-wend-${props.providerId}`}
                          checked={windowEndPolicy === 'pause'}
                          disabled={saving}
                          onChange={() => { setWindowEndPolicy('pause') }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('windowEndPause')}</span>
                          <span className="dsh-opj_hint">{t('windowEndPauseHint')}</span>
                        </span>
                      </span>
                    </label>
                    <p className="dsh-opj_hint">{t('windowEndNote')}</p>
                    {baselineRef.current?.windowEndPolicy === 'pause'
                      && windowEndPolicy === 'continue' && (
                      <p className="dsh-opj_hint">{t('windowEndSwitchHint')}</p>
                    )}
                  </div>

                  <div className="dsh-opj_field">
                    <span className="dsh-opj_radioTitle">{t('approvalPolicyTitle')}</span>
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-appr-${props.providerId}`}
                          checked={defaultApprovalPolicy === 'reject'}
                          disabled={saving}
                          onChange={() => { setDefaultApprovalPolicy('reject') }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('approvalReject')}</span>
                          <span className="dsh-opj_hint">{t('approvalRejectHint')}</span>
                        </span>
                      </span>
                    </label>
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-appr-${props.providerId}`}
                          checked={defaultApprovalPolicy === 'wait'}
                          disabled={saving}
                          onChange={() => { setDefaultApprovalPolicy('wait') }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('approvalWait')}</span>
                          <span className="dsh-opj_hint">{t('approvalWaitHint')}</span>
                        </span>
                      </span>
                    </label>
                    <label className="dsh-opj_field">
                      <span className="dsh-opj_fieldLabel">
                        <input
                          type="radio"
                          name={`opj-appr-${props.providerId}`}
                          checked={defaultApprovalPolicy === 'allow'}
                          disabled={saving}
                          onChange={() => {
                            if (defaultApprovalPolicy === 'allow') return
                            setAllowConfirmOpen(true)
                          }}
                        />
                        <span className="dsh-opj_radioRow">
                          <span className="dsh-opj_radioTitle">{t('approvalAllow')}</span>
                          <span className="dsh-opj_hint">{t('approvalAllowHint')}</span>
                        </span>
                      </span>
                    </label>
                    <p className="dsh-opj_hint">{t('approvalPolicyHint')}</p>
                    <Modal
                      open={allowConfirmOpen}
                      onClose={() => { setAllowConfirmOpen(false) }}
                      title={t('approvalAllowConfirmTitle')}
                      closeLabel={t('approvalAllowCancel')}
                      description={t('approvalAllowConfirmHint')}
                      footer={(
                        <>
                          <Button
                            variant="outline"
                            onClick={() => { setAllowConfirmOpen(false) }}
                          >
                            {t('approvalAllowCancel')}
                          </Button>
                          <Button
                            variant="primary"
                            autoFocus
                            onClick={() => {
                              setDefaultApprovalPolicy('allow')
                              setAllowConfirmOpen(false)
                            }}
                          >
                            {t('approvalAllowConfirm')}
                          </Button>
                        </>
                      )}
                    />
                  </div>
                </>
              )}

              {error && <p className="dsh-opj_error">{error}</p>}
              {savedFlash && <p className="dsh-opj_saved">{t('providerSaved')}</p>}

              <div className="dsh-opj_actions">
                <button
                  type="button"
                  className="dsh-opj_secondaryButton"
                  disabled={saving || !loaded}
                  onClick={cancel}
                >
                  {t('providerCancel')}
                </button>
                <button
                  type="button"
                  className="dsh-opj_primaryButton"
                  disabled={saving || !loaded}
                  onClick={() => { void save() }}
                >
                  {saving ? t('providerSaving') : t('providerSave')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
