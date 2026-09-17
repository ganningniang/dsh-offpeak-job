/**
 * Client: composer off-peak Menu chip + Models provider-card peak settings.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconClockOutline16,
  IconPlayOutline16,
  Menu,
  Modal,
  Button,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ProviderPeakSettings } from './provider-settings.tsx'
import { OffpeakOverviewEntry } from './overview.tsx'
import { onOffpeakProviderConfigChange } from './config-events.ts'
import { en, zh, type OffpeakKey } from './locales.ts'

const NS = 'offpeak-job'
const STYLE_ID = 'dsh-opj-chip-css-v7'
const DOCK_STYLE_ID = 'dsh-opj-wait-dock-css-v7'

/** Mirror PermissionSelect trigger + AgentPresetSeat stacked menu rows. */
const CHIP_STYLES = `
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
  /* Match agent-preset / 运行模式 menu card width (Menu list min 218 → ~300+). */
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
`

/**
 * Same outer box as QueueDock.module.css `.dock`. When a queue dock is present,
 * a layout pass copies its border-box width/left so the strips cannot diverge.
 */
const WAIT_DOCK_STYLES = `
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
`

function ensureChipStyles(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (el === null) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = CHIP_STYLES
}

function ensureWaitDockStyles(): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(DOCK_STYLE_ID) as HTMLStyleElement | null
  if (el === null) {
    el = document.createElement('style')
    el.id = DOCK_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = WAIT_DOCK_STYLES
}

interface TimeWindow {
  startMin: number
  endMin: number
  days?: 'all' | 'weekdays' | 'weekends'
}

interface SessionPayload {
  config: { enabled: boolean }
  providerId?: string
  provider?: {
    config: {
      scheduleKind: string
      idleWindows?: TimeWindow[]
      chipVisible?: boolean
    }
    summary?: string
    scheduleActive?: boolean
    chipVisible?: boolean
    showComposerChip?: boolean
  }
  /** True when the provider has a usable peak/off-peak schedule (not `none`). */
  scheduleActive?: boolean
  chipVisible?: boolean
  /** Composer shows the run-timing dropdown. */
  showComposerChip?: boolean
  deferredNow?: boolean
  isPeakNow: boolean
  /** Live park wait; null when no messages are held for 谷时. */
  waitingUntil?: string | null
  waitingSince?: string | null
  parked?: Array<{
    id: string
    textPreview: string
    parkedAt: string
    kind?: 'user' | 'resume'
    /** Soft park also mirrored in QueueDock — WaitDock omits that preview. */
    inboxMirrored?: boolean
  }>
  resumePending?: boolean
  sendConflict?: boolean
  nextOffpeak: string
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

function resolveProviderFromProps(props: any): string | undefined {
  try {
    const proj = props.useProjection?.('modelSelection')
    const next = proj?.next ?? proj?.pending
    const last = proj?.lastUsed
    const id = next?.provider ?? last?.provider
    if (typeof id === 'string' && id.length > 0) return id
  } catch {
    // projection may be absent
  }
  return undefined
}

function formatNextAt(iso: string | null): string {
  if (iso === null) return ''
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function minToClock(min: number): string {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function formatIdleWindow(
  w: TimeWindow,
  t: (key: OffpeakKey) => string,
): string {
  const range = w.startMin === w.endMin
    ? t('daysFullDay')
    : `${minToClock(w.startMin)}–${minToClock(w.endMin)}`
  const days = w.days === 'weekdays' || w.days === 'weekends' ? w.days : 'all'
  if (days === 'all') return `${t('daysAll')} ${range}`
  if (days === 'weekdays') return `${t('daysWeekdays')} ${range}`
  return `${t('daysWeekends')} ${range}`
}

/** Human-readable idle schedule for the off-peak menu description. */
function formatScheduleWindows(
  kind: string | undefined,
  windows: TimeWindow[] | undefined,
  t: (key: OffpeakKey) => string,
): string {
  if (kind === 'deepseek') return t('kindDeepseekHint')
  if (windows === undefined || windows.length === 0) return t('kindDeepseekHint')
  return windows.map(w => formatIdleWindow(w, t)).join('；')
}

function menuLabel(icon: ReactNode, name: string, description: ReactNode): ReactNode {
  return (
    <span className="dsh-opj_item">
      <span className="dsh-opj_itemIcon" aria-hidden>{icon}</span>
      <span className="dsh-opj_itemName">{name}</span>
      <span className="dsh-opj_itemDesc">{description}</span>
    </span>
  )
}

/** Split `menuOffpeakDesc` so the window list can use the warn (yellow) accent. */
function offpeakWindowsDescription(
  template: string,
  windowsText: string,
): ReactNode {
  const parts = template.split('{windows}')
  if (parts.length < 2) {
    return <>{template.replace('{windows}', windowsText)}</>
  }
  return (
    <>
      {parts[0]}
      <span className="dsh-opj_windowsAccent">{windowsText}</span>
      {parts.slice(1).join('{windows}')}
    </>
  )
}

/** Composer dock: parked messages waiting for an idle window (session stays idle). */
function OffpeakWaitDock(props: {
  sessionId: string
  providerId?: string
  /** Session snapshot hook from the dock slot; used to refresh as soon as QueueDock rows appear. */
  useSession: (selector: (s: any) => unknown) => unknown
  t?: (key: OffpeakKey) => string
}) {
  ensureWaitDockStyles()
  const { sessionId, useSession } = props
  const t = (key: OffpeakKey) => translate(props.t, key)
  const providerId = props.providerId ?? 'deepseek-official'
  const [waitingUntil, setWaitingUntil] = useState<string | null>(null)
  const [parked, setParked] = useState<Array<{
    id: string
    textPreview: string
    kind: 'user' | 'resume'
    inboxMirrored?: boolean
  }>>([])
  const [resumePending, setResumePending] = useState(false)
  const [sendConflict, setSendConflict] = useState(false)
  const [deferredNow, setDeferredNow] = useState(false)
  const [nextOffpeak, setNextOffpeak] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)

  // Same signals QueueDock uses — when they move, the Host park is (or is about to be) committed.
  const queueFingerprint = useSession((s: any) => {
    const queue = Array.isArray(s.queue) ? s.queue : []
    const pending = Array.isArray(s.pendingSubmissions) ? s.pendingSubmissions : []
    const queued = queue
      .filter((row: any) => row?.placement === 'queued')
      .map((row: any) => row.id)
      .join(',')
    const pendingQueued = pending
      .filter((row: any) => row?.placement === 'queued')
      .map((row: any) => row.requestId)
      .join(',')
    return `${queued}|${pendingQueued}`
  }) as string
  const hasQueueRows = queueFingerprint !== '|' && queueFingerprint !== ''

  const refresh = useCallback(async () => {
    try {
      const q = `?provider=${encodeURIComponent(providerId)}`
      const data = await api<SessionPayload>(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}${q}`,
      )
      setWaitingUntil(typeof data.waitingUntil === 'string' ? data.waitingUntil : null)
      setParked((data.parked ?? [])
        .filter(row => row.kind !== 'notice')
        .map(row => ({
          id: row.id,
          textPreview: row.textPreview,
          kind: row.kind === 'resume' ? 'resume' : 'user',
          inboxMirrored: row.inboxMirrored === true,
        })))
      setResumePending(Boolean(data.resumePending) || (data.parked ?? []).some(r => r.kind === 'resume'))
      setSendConflict(Boolean(data.sendConflict))
      setDeferredNow(Boolean(data.deferredNow ?? data.isPeakNow))
      setNextOffpeak(typeof data.nextOffpeak === 'string' ? data.nextOffpeak : null)
    } catch {
      setWaitingUntil(null)
      setParked([])
      setResumePending(false)
      setSendConflict(false)
      setDeferredNow(false)
      setNextOffpeak(null)
    }
  }, [sessionId, providerId])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 2_000)
    return () => clearInterval(id)
  }, [refresh])

  // Fire with the queue strip: pending row → immediate + short burst; admitted row → once more.
  useEffect(() => {
    void refresh()
    if (!hasQueueRows) return
    const timers = [80, 200, 500].map(ms => window.setTimeout(() => { void refresh() }, ms))
    return () => {
      for (const id of timers) window.clearTimeout(id)
    }
  }, [queueFingerprint, hasQueueRows, refresh])

  useEffect(() => onOffpeakProviderConfigChange(() => { void refresh() }), [refresh])

  // Show with QueueDock for inbox parks; soft parks keep the strip even without queue rows.
  // When the last queue row is deleted, hide immediately (do not wait for cancel-wait).
  const displayUntil = parked.length > 0
    ? waitingUntil
    : hasQueueRows
      ? (waitingUntil ?? (deferredNow ? nextOffpeak : null))
      : null
  const show = !(displayUntil === null && parked.length === 0)

  // Pixel-match the live QueueDock border box (CSS formula alone can still diverge
  // if the two docks sit in slightly different percentage bases).
  useLayoutEffect(() => {
    const wait = dockRef.current
    if (wait === null || !show) return

    const clear = () => {
      wait.removeAttribute('data-match-queue')
      wait.style.removeProperty('width')
      wait.style.removeProperty('max-width')
    }

    const sync = () => {
      const seat = wait.closest('[data-composer-seat]')
        ?? document.querySelector('[data-composer-seat]')
      const queue = seat?.querySelector('[data-queue-dock]') as HTMLElement | null
      if (queue === null || !hasQueueRows) {
        clear()
        return
      }
      const q = queue.getBoundingClientRect()
      if (q.width < 1) {
        clear()
        return
      }
      // Same parent + equal width + CSS `margin: 0 auto` keeps left edges aligned.
      // Do not set marginLeft from getBoundingClientRect — that distance includes
      // the parent's padding/border and shifts the wait strip right.
      wait.setAttribute('data-match-queue', '')
      wait.style.width = `${q.width}px`
      wait.style.maxWidth = `${q.width}px`
    }

    sync()
    const seat = wait.closest('[data-composer-seat]')
      ?? document.querySelector('[data-composer-seat]')
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    const queue = seat?.querySelector('[data-queue-dock]')
    if (ro !== null) {
      ro.observe(wait)
      if (queue !== null) ro.observe(queue)
      if (wait.parentElement !== null) ro.observe(wait.parentElement)
    }
    window.addEventListener('resize', sync)
    const mo = seat === null ? null : new MutationObserver(sync)
    mo?.observe(seat, { childList: true, subtree: true })
    const retry = window.setTimeout(sync, 50)
    return () => {
      window.clearTimeout(retry)
      window.removeEventListener('resize', sync)
      ro?.disconnect()
      mo?.disconnect()
      clear()
    }
  }, [show, hasQueueRows, queueFingerprint])

  const resumeCount = parked.filter(row => row.kind === 'resume').length
  const totalUserCount = parked.length - resumeCount
  // Inbox mirrors already appear in QueueDock — do not repeat those previews here.
  // If QueueDock rows are not up yet, keep the WaitDock preview as a fallback.
  const visibleParked = parked.filter(row => {
    if (row.kind === 'resume') return true
    if (row.inboxMirrored === true && hasQueueRows) return false
    return true
  })
  const visibleUserCount = visibleParked.filter(row => row.kind !== 'resume').length
  const isResumeMode = resumeCount > 0
  const detail = displayUntil === null
    ? t('waitDockEmpty')
    : t(isResumeMode ? 'waitDockResumeDetail' : 'waitDockDetail').replace('{time}', formatNextAt(displayUntil))
  const visibleResumeCount = visibleParked.filter(row => row.kind === 'resume').length
  const parkedLabel = visibleUserCount > 0 && visibleResumeCount > 0
    ? t('waitDockMixedParked')
      .replace('{r}', String(visibleResumeCount))
      .replace('{u}', String(visibleUserCount))
    : isResumeMode && visibleUserCount === 0
      ? t('waitDockResumeParked').replace('{n}', String(visibleResumeCount || resumeCount))
      : t('waitDockParked').replace('{n}', String(visibleParked.length))

  if (!show) return null

  return (
    <div ref={dockRef} className="dsh-opj_waitDock">
      <Modal
        open={sendConflict && resumePending}
        onClose={() => {
          void api(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
            method: 'POST',
            body: JSON.stringify({ action: 'keep-resume' }),
          }).then(() => refresh())
        }}
        title={t('resumeConflictTitle')}
        closeLabel={t('resumeConflictClose')}
        description={t('resumeConflictHint')}
        footer={(
          <>
            <Button
              variant="outline"
              onClick={() => {
                void api(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
                  method: 'POST',
                  body: JSON.stringify({ action: 'discard-resume' }),
                }).then(() => refresh())
              }}
            >
              {t('resumeConflictDiscard')}
            </Button>
            <Button
              variant="primary"
              autoFocus
              onClick={() => {
                void api(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/resolve-send?provider=${encodeURIComponent(providerId)}`, {
                  method: 'POST',
                  body: JSON.stringify({ action: 'keep-resume' }),
                }).then(() => refresh())
              }}
            >
              {t('resumeConflictKeep')}
            </Button>
          </>
        )}
      />
      <div
        className="dsh-opj_waitPanel"
        style={{ flexWrap: 'wrap' }}
        role="status"
        aria-live="polite"
      >
        <span className="dsh-opj_waitLead" aria-hidden><IconClockOutline16 /></span>
        <span className="dsh-opj_waitCopy">
          <span className="dsh-opj_waitTitle">
            {t(isResumeMode ? 'waitDockResumeTitle' : 'waitDockTitle')}
          </span>
          <span className="dsh-opj_waitDetail">{detail}</span>
          {visibleParked.length > 0 && (
            <span className="dsh-opj_waitParked">
              <span className="dsh-opj_waitParkedLabel">{parkedLabel}</span>
              <span className="dsh-opj_waitParkedList">
                {visibleParked.map(row => {
                  const preview = row.kind === 'resume'
                    ? t('waitDockResumePreview')
                    : (row.textPreview || '…')
                  return (
                    <span key={row.id} className="dsh-opj_waitParkedItem" title={preview}>
                      {preview}
                    </span>
                  )
                })}
              </span>
            </span>
          )}
        </span>
        <button
          type="button"
          className="dsh-opj_waitAction"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/cancel-wait`, {
              method: 'POST',
            }).then(() => {
              setWaitingUntil(null)
              setParked([])
              setResumePending(false)
              setSendConflict(false)
              return refresh()
            }).finally(() => setBusy(false))
          }}
        >
          {t(isResumeMode && totalUserCount === 0 ? 'waitDockResumeCancel' : 'waitDockCancel')}
        </button>
        <button
          type="button"
          className="dsh-opj_waitAction"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api(`/api/offpeak-job/session/${encodeURIComponent(sessionId)}/release?provider=${encodeURIComponent(providerId)}`, {
              method: 'POST',
            }).then(() => {
              setWaitingUntil(null)
              setParked([])
              setResumePending(false)
              setSendConflict(false)
              return refresh()
            }).finally(() => setBusy(false))
          }}
        >
          {t(isResumeMode ? 'waitDockResumeRunNow' : 'waitDockRunNow')}
        </button>
      </div>
    </div>
  )
}

function OffpeakControl(props: {
  sessionId: string
  providerId?: string
  t?: (key: OffpeakKey) => string
}) {
  ensureChipStyles()
  const { sessionId } = props
  const t = (key: OffpeakKey) => translate(props.t, key)
  const providerId = props.providerId ?? 'deepseek-official'
  const [enabled, setEnabled] = useState(false)
  const [scheduleActive, setScheduleActive] = useState(false)
  const [showComposerChip, setShowComposerChip] = useState(false)
  const [scheduleKind, setScheduleKind] = useState<string>('none')
  const [idleWindows, setIdleWindows] = useState<TimeWindow[]>([])
  const [deferredNow, setDeferredNow] = useState(false)
  const [nextOffpeak, setNextOffpeak] = useState<string | null>(null)
  const [waitingUntil, setWaitingUntil] = useState<string | null>(null)
  const [parkedCount, setParkedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const applyPayload = (data: SessionPayload) => {
    const active = data.scheduleActive
      ?? data.provider?.scheduleActive
      ?? data.provider?.config.scheduleKind !== 'none'
    const chip = data.showComposerChip
      ?? data.provider?.showComposerChip
      ?? ((data.chipVisible ?? data.provider?.chipVisible ?? data.provider?.config.chipVisible) !== false
        && active)
    setEnabled(data.config.enabled)
    setScheduleActive(active)
    setShowComposerChip(chip)
    setScheduleKind(data.provider?.config.scheduleKind ?? 'none')
    setIdleWindows(data.provider?.config.idleWindows?.map(w => ({ ...w })) ?? [])
    setDeferredNow(data.deferredNow ?? data.isPeakNow)
    setNextOffpeak(data.nextOffpeak)
    setWaitingUntil(typeof data.waitingUntil === 'string' ? data.waitingUntil : null)
    setParkedCount(data.parked?.length ?? 0)
    setError(null)
  }

  const refresh = useCallback(async () => {
    try {
      const q = `?provider=${encodeURIComponent(providerId)}`
      const data = await api<SessionPayload>(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}${q}`,
      )
      applyPayload(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadError'))
    }
  }, [sessionId, providerId])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => onOffpeakProviderConfigChange(() => { void refresh() }), [refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!scheduleActive || !showComposerChip) setOpen(false)
  }, [scheduleActive, showComposerChip])

  const persist = async (nextEnabled: boolean) => {
    if (!scheduleActive || !showComposerChip || busy) return
    if (nextEnabled === enabled) return
    setBusy(true)
    try {
      const data = await api<SessionPayload>(
        `/api/offpeak-job/session/${encodeURIComponent(sessionId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ enabled: nextEnabled, provider: providerId }),
        },
      )
      applyPayload(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  if (!showComposerChip) return null

  const interactive = scheduleActive
  const waiting = interactive && enabled && (parkedCount > 0 || waitingUntil !== null || deferredNow)
  const offpeak = interactive && enabled
  const selectedId = offpeak ? 'offpeak' : 'immediate'
  const triggerLabel = offpeak ? t('chipOffpeak') : t('chipImmediate')
  const TriggerIcon = offpeak ? IconClockOutline16 : IconPlayOutline16

  let title: string | undefined
  if (!interactive) {
    title = t('chipTitleUnavailable')
  } else if (!offpeak) {
    title = t('chipTitleImmediate')
  } else {
    // Off-peak: the open menu already describes windows; no hover tip.
    title = undefined
  }

  const windowsText = formatScheduleWindows(scheduleKind, idleWindows, t)
  const offpeakDesc = offpeakWindowsDescription(t('menuOffpeakDesc'), windowsText)

  const items: MenuEntry[] = [
    {
      id: 'offpeak',
      label: menuLabel(<IconClockOutline16 />, t('menuOffpeak'), offpeakDesc),
    },
    {
      id: 'immediate',
      label: menuLabel(<IconPlayOutline16 />, t('menuImmediate'), t('menuImmediateDesc')),
    },
  ]

  const triggerClass = [
    'dsh-opj_trigger',
    waiting ? 'dsh-opj_triggerWait' : offpeak ? 'dsh-opj_triggerOffpeak' : '',
  ].filter(Boolean).join(' ')

  const trigger = (
    <button
      type="button"
      className={triggerClass}
      aria-label={t('chipAriaCurrent').replace('{name}', triggerLabel)}
      title={title}
      disabled={!interactive || busy}
      onClick={() => {
        if (!interactive || busy) return
        if (open) {
          setOpen(false)
          return
        }
        // Re-fetch before open so Models → Peak Apply shows up immediately.
        void refresh().then(() => { setOpen(true) })
      }}
    >
      <span className="dsh-opj_triggerIcon" aria-hidden>
        <TriggerIcon />
      </span>
      <span className="dsh-opj_triggerLabel">{triggerLabel}</span>
      <span
        className={open ? 'dsh-opj_chevron dsh-opj_chevronOpen' : 'dsh-opj_chevron'}
        aria-hidden
      >
        <IconChevronDownOutline14 />
      </span>
    </button>
  )

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {error ? (
        <span style={{ color: 'var(--dsw-alias-state-error-primary, #b00020)', fontSize: 11, maxWidth: 120 }}>
          {error}
        </span>
      ) : null}
      {interactive ? (
        <Menu
          open={open}
          items={items}
          selectedId={selectedId}
          onSelect={(id) => {
            setOpen(false)
            void persist(id === 'offpeak')
          }}
          onClose={() => { setOpen(false) }}
          side="top"
          anchor={trigger}
        />
      ) : trigger}
    </span>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  if (ctx.locale?.register) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'offpeak-job: locale')
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'offpeak-job',
    order: 10,
    locale: NS,
  }, (props: any) => {
    const sessionId = props.sessionId as string | undefined
    if (!sessionId) return null
    return (
      <OffpeakControl
        sessionId={sessionId}
        providerId={resolveProviderFromProps(props)}
        t={props.t}
      />
    )
  }))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'offpeak-wait',
    order: 15,
    locale: NS,
  }, (props: any) => {
    const sessionId = props.sessionId as string | undefined
    if (!sessionId || typeof props.useSession !== 'function') return null
    return (
      <OffpeakWaitDock
        sessionId={sessionId}
        providerId={resolveProviderFromProps(props)}
        useSession={props.useSession}
        t={props.t}
      />
    )
  }))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'offpeak-overview',
    order: 15,
    locale: NS,
    inject: () => ({
      openSession: (sessionId: string) => {
        const sessions = ctx.get?.('sessions') ?? (ctx as any).sessions
        if (sessions && typeof sessions.open === 'function') {
          sessions.open(sessionId)
        }
      },
    }),
  }, (props: any) => (
    <OffpeakOverviewEntry
      wide={props.wide !== false}
      t={props.t}
      openSession={props.openSession}
      useSessions={props.useSessions}
    />
  )))

  // Keyed by settings namespace — register for both shipped adapter families.
  for (const key of ['llm-deepseek', 'llm-pi-ai'] as const) {
    ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
      name: 'settings.models.provider-card',
      key,
      id: `offpeak-job:${key}`,
      locale: NS,
    }, (props: any) => {
      const providerId = props.provider?.provider as string | undefined
      if (!providerId) return null
      return <ProviderPeakSettings providerId={providerId} t={props.t} />
    }))
  }
}
