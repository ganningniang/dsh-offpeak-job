/**
 * Sidebar-foot 谷时总览: status board for Off-peak-run sessions.
 * Start now / Discard only when waiting for an idle window.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { zh, en, type OffpeakKey } from './locales.ts'
import { onOffpeakProviderConfigChange } from './config-events.ts'

type OverviewStatus =
  | 'waiting'
  | 'resume'
  | 'approval'
  | 'running'
  | 'idle'
  | 'conflict'
  | 'orphan'

type OverviewFilter = 'active' | OverviewStatus

interface OverviewSessionRow {
  sessionId: string
  enabled: boolean
  providerId: string | null
  status: OverviewStatus
  waitingUntil: string | null
  parkedUser: number
  parkedResume: number
  sendConflict: boolean
  textPreview: string
  orphan?: boolean
  approvalPending?: boolean
  windowWait?: boolean
}

interface OverviewPayload {
  entryVisible?: boolean
  badgeCount: number
  sessions: OverviewSessionRow[]
  generatedAt: string
}

const STYLE_ID = 'dsh-opj-overview-css-v4'
const STYLES = `
.dsh-opj_ovLayer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}
.dsh-opj_ovLayer[data-rail] { width: 36px; height: 36px; margin: 0; }
.dsh-opj_ovBadge {
  display: inline-flex; align-items: center; gap: 8px;
  width: calc(100% + 4px); height: 42px; margin: 0 -2px; padding: 0 10px 0 8px;
  border: none; border-radius: 12px; background: transparent;
  color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px;
  cursor: pointer; overflow: hidden;
}
.dsh-opj_ovBadge:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-opj_ovBadge[data-active] { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-opj_ovLayer[data-rail] .dsh-opj_ovBadge {
  justify-content: center; gap: 0; width: 36px; height: 36px; padding: 0; border-radius: 50%;
}
.dsh-opj_ovLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-opj_ovCount {
  flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums;
}
.dsh-opj_ovCount[data-attention] {
  color: var(--dsw-alias-state-warn-primary, #f5a623); font-weight: 600;
}
.dsh-opj_ovPanel {
  position: fixed; z-index: 30; display: flex; flex-direction: column;
  width: 440px; max-width: calc(100vw - 24px); max-height: 70vh; overflow: hidden;
  border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-module-platform));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgb(0 0 0 / 18%));
  color: var(--dsw-alias-label-primary);
}
.dsh-opj_ovHead {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px 8px;
}
.dsh-opj_ovTitle { margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.dsh-opj_ovClose {
  box-sizing: border-box; height: 28px; padding: 0 10px; border: none; border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-opj_ovClose:hover {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.dsh-opj_ovFilters {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.dsh-opj_ovFilter {
  box-sizing: border-box; height: 26px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 13px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.dsh-opj_ovFilter[data-active] {
  border-color: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-opj_ovBody { overflow: auto; padding: 8px 0 12px; }
.dsh-opj_ovNote, .dsh-opj_ovError {
  margin: 8px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.dsh-opj_ovError { color: var(--dsw-alias-state-error-primary); }
.dsh-opj_ovRow {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 14px;
  border: none; background: transparent; text-align: left;
}
.dsh-opj_ovRow + .dsh-opj_ovRow { border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dsh-opj_ovRowTop { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-opj_ovSession {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0; border: none; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  text-align: left; cursor: pointer;
}
.dsh-opj_ovSession:hover {
  color: var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary));
  text-decoration: underline;
}
.dsh-opj_ovSession:disabled { cursor: default; text-decoration: none; opacity: 0.7; }
.dsh-opj_ovStatus {
  flex: none; margin-left: auto; font-size: 12px; line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-opj_ovStatus[data-status="conflict"],
.dsh-opj_ovStatus[data-status="resume"],
.dsh-opj_ovStatus[data-status="waiting"],
.dsh-opj_ovStatus[data-status="approval"],
.dsh-opj_ovStatus[data-status="orphan"] {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}
.dsh-opj_ovMeta { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsh-opj_ovMetaRow {
  display: flex; align-items: baseline; gap: 10px; min-width: 0;
  margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.dsh-opj_ovNext {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-opj_ovProvider {
  flex: 0 1 auto; max-width: 42%;
  margin-left: auto;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: right;
}
.dsh-opj_ovPreview {
  margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-opj_ovActions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.dsh-opj_ovAction {
  box-sizing: border-box; height: 28px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 14px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.dsh-opj_ovAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dsh-opj_ovAction[data-primary] {
  border: none; background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-opj_ovAction[data-primary]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dsh-opj_ovAction:disabled { opacity: 0.5; cursor: default; }
`

const FILTERS: OverviewFilter[] = [
  'active', 'waiting', 'approval', 'resume', 'running', 'idle', 'conflict', 'orphan',
]

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

function translate(
  t: ((key: OffpeakKey, vars?: Record<string, string | number>) => string) | undefined,
  key: OffpeakKey,
  vars?: Record<string, string | number>,
): string {
  const fromProp = t?.(key, vars)
  let text = typeof fromProp === 'string' && fromProp.trim() !== ''
    ? fromProp
    : (zh[key] ?? en[key] ?? key)
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

function formatUntil(iso: string | null, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date)
  } catch {
    return iso
  }
}

function shortSessionId(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

function statusLabel(
  t: (key: OffpeakKey, vars?: Record<string, string | number>) => string,
  status: OverviewStatus,
): string {
  switch (status) {
    case 'waiting': return t('overviewStatusWaiting')
    case 'resume': return t('overviewStatusResume')
    case 'approval': return t('overviewStatusApproval')
    case 'running': return t('overviewStatusRunning')
    case 'idle': return t('overviewStatusIdle')
    case 'conflict': return t('overviewStatusConflict')
    case 'orphan': return t('overviewStatusOrphan')
    default: return status
  }
}

function filterLabel(
  t: (key: OffpeakKey, vars?: Record<string, string | number>) => string,
  filter: OverviewFilter,
): string {
  if (filter === 'active') return t('overviewFilterActive')
  return statusLabel(t, filter)
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
  }
  return body as T
}

function OffpeakOverviewInner(props: {
  wide: boolean
  t?: (key: OffpeakKey, vars?: Record<string, string | number>) => string
  openSession?: (sessionId: string) => void
  titles: Record<string, string>
}) {
  ensureStyles()
  const t = (key: OffpeakKey, vars?: Record<string, string | number>) =>
    translate(props.t, key, vars)
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()
  const [payload, setPayload] = useState<OverviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<OverviewFilter>('active')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [entryVisible, setEntryVisible] = useState(true)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      const next = await apiJson<OverviewPayload>('/api/offpeak-job/overview')
      setPayload(next)
      setEntryVisible(next.entryVisible !== false)
      setError(null)
      if (next.entryVisible === false) setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('overviewLoadError'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => onOffpeakProviderConfigChange(() => { void refresh({ silent: true }) }), [refresh])

  useEffect(() => {
    void refresh()
    // Open panel: 1s; badge when closed: 5s (was 2s / 15s).
    const ms = open ? 1_000 : 5_000
    const timer = window.setInterval(() => { void refresh({ silent: true }) }, ms)
    return () => { window.clearInterval(timer) }
  }, [open, refresh])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect !== undefined) {
        setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
      }
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current
      if (root === null) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows = useMemo(() => {
    const list = payload?.sessions ?? []
    if (filter === 'active') return list.filter(row => row.status !== 'idle')
    return list.filter(row => row.status === filter)
  }, [payload, filter])

  const runRow = async (sessionId: string, work: () => Promise<void>) => {
    setBusyId(sessionId)
    setActionError(null)
    try {
      await work()
      await refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('overviewActionError'))
    } finally {
      setBusyId(null)
    }
  }

  const release = (row: OverviewSessionRow) => {
    const q = row.providerId ? `?provider=${encodeURIComponent(row.providerId)}` : ''
    void runRow(row.sessionId, async () => {
      await apiJson(`/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/release${q}`, {
        method: 'POST', body: '{}',
      })
    })
  }

  const cancelWait = (row: OverviewSessionRow) => {
    void runRow(row.sessionId, async () => {
      await apiJson(`/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/cancel-wait`, {
        method: 'POST', body: '{}',
      })
    })
  }

  const resolveConflict = (row: OverviewSessionRow, action: 'keep-resume' | 'discard-resume') => {
    const q = row.providerId ? `?provider=${encodeURIComponent(row.providerId)}` : ''
    void runRow(row.sessionId, async () => {
      await apiJson(
        `/api/offpeak-job/session/${encodeURIComponent(row.sessionId)}/resolve-send${q}`,
        { method: 'POST', body: JSON.stringify({ action }) },
      )
    })
  }

  const badgeCount = payload?.badgeCount ?? 0
  const locale = typeof navigator !== 'undefined' && navigator.language.startsWith('zh')
    ? 'zh-CN' : 'en'
  const canOpen = typeof props.openSession === 'function'

  if (!entryVisible) return null

  return (
    <div
      ref={rootRef}
      className="dsh-opj_ovLayer"
      {...(props.wide ? {} : { 'data-rail': '' })}
    >
      {open && (
        <section
          className="dsh-opj_ovPanel"
          style={anchor ? { left: anchor.left, bottom: anchor.bottom } : undefined}
          role="dialog"
          aria-label={t('overviewTitle')}
        >
          <header className="dsh-opj_ovHead">
            <h2 className="dsh-opj_ovTitle">{t('overviewTitle')}</h2>
            <button type="button" className="dsh-opj_ovClose" onClick={() => { setOpen(false) }}>
              {t('overviewClose')}
            </button>
          </header>
          <div className="dsh-opj_ovFilters" role="tablist" aria-label={t('overviewFiltersAria')}>
            {FILTERS.map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                className="dsh-opj_ovFilter"
                aria-selected={filter === id}
                {...(filter === id ? { 'data-active': '' } : {})}
                onClick={() => { setFilter(id) }}
              >
                {filterLabel(t, id)}
              </button>
            ))}
          </div>
          <div className="dsh-opj_ovBody">
            {error && <p className="dsh-opj_ovError" role="alert">{error}</p>}
            {actionError && <p className="dsh-opj_ovError" role="alert">{actionError}</p>}
            {!error && loading && payload === null && (
              <p className="dsh-opj_ovNote">{t('overviewLoading')}</p>
            )}
            {!error && payload !== null && rows.length === 0 && (
              <p className="dsh-opj_ovNote">
                {filter === 'active' ? t('overviewEmpty') : t('overviewFilterEmpty')}
              </p>
            )}
            {rows.map(row => {
              const busy = busyId === row.sessionId
              const title = props.titles[row.sessionId] || shortSessionId(row.sessionId)
              const isOrphan = row.status === 'orphan' || row.orphan === true
              const windowWait = row.windowWait === true
              return (
                <div key={row.sessionId} className="dsh-opj_ovRow">
                  <div className="dsh-opj_ovRowTop">
                    <button
                      type="button"
                      className="dsh-opj_ovSession"
                      title={row.sessionId}
                      disabled={!canOpen || isOrphan}
                      onClick={() => {
                        if (!canOpen || isOrphan) return
                        props.openSession?.(row.sessionId)
                        setOpen(false)
                      }}
                    >
                      {title}
                    </button>
                    <span className="dsh-opj_ovStatus" data-status={row.status}>
                      {statusLabel(t, row.status)}
                    </span>
                  </div>
                  {isOrphan && (
                    <p className="dsh-opj_ovMeta">{t('overviewOrphanHint')}</p>
                  )}
                  {(row.waitingUntil || row.providerId) && (
                    <div className="dsh-opj_ovMetaRow">
                      {row.waitingUntil ? (
                        <span className="dsh-opj_ovNext">
                          {t('overviewNextAt', { time: formatUntil(row.waitingUntil, locale) })}
                        </span>
                      ) : <span className="dsh-opj_ovNext" />}
                      {row.providerId && (
                        <span
                          className="dsh-opj_ovProvider"
                          title={row.providerId}
                        >
                          {t('overviewProvider', { id: row.providerId })}
                        </span>
                      )}
                    </div>
                  )}
                  {(row.parkedUser > 0 || row.parkedResume > 0) && (
                    <p className="dsh-opj_ovMeta">
                      {row.parkedResume > 0 && row.parkedUser > 0
                        ? t('overviewParkedMixed', { r: row.parkedResume, u: row.parkedUser })
                        : row.parkedResume > 0
                          ? t('overviewParkedResume', { n: row.parkedResume })
                          : t('overviewParkedUser', { n: row.parkedUser })}
                    </p>
                  )}
                  {row.textPreview && <p className="dsh-opj_ovPreview">{row.textPreview}</p>}
                  <div className="dsh-opj_ovActions">
                    {canOpen && !isOrphan && (
                      <button
                        type="button"
                        className="dsh-opj_ovAction"
                        disabled={busy}
                        onClick={() => {
                          props.openSession?.(row.sessionId)
                          setOpen(false)
                        }}
                      >
                        {t('overviewOpenSession')}
                      </button>
                    )}
                    {windowWait && !isOrphan && (
                      <button
                        type="button"
                        className="dsh-opj_ovAction"
                        data-primary=""
                        disabled={busy}
                        onClick={() => { release(row) }}
                      >
                        {t('overviewRelease')}
                      </button>
                    )}
                    {windowWait && !isOrphan && (
                      <button
                        type="button"
                        className="dsh-opj_ovAction"
                        disabled={busy}
                        onClick={() => { cancelWait(row) }}
                      >
                        {t('overviewCancelWait')}
                      </button>
                    )}
                    {isOrphan && windowWait && (
                      <button
                        type="button"
                        className="dsh-opj_ovAction"
                        data-primary=""
                        disabled={busy}
                        onClick={() => { cancelWait(row) }}
                      >
                        {t('overviewDiscardOrphan')}
                      </button>
                    )}
                    {row.sendConflict && !isOrphan && (
                      <>
                        <button
                          type="button"
                          className="dsh-opj_ovAction"
                          disabled={busy}
                          onClick={() => { resolveConflict(row, 'keep-resume') }}
                        >
                          {t('overviewKeepResume')}
                        </button>
                        <button
                          type="button"
                          className="dsh-opj_ovAction"
                          disabled={busy}
                          onClick={() => { resolveConflict(row, 'discard-resume') }}
                        >
                          {t('overviewDiscardResume')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <button
        type="button"
        className="dsh-opj_ovBadge"
        data-active={open || badgeCount > 0 || undefined}
        aria-label={t('overviewTriggerAria')}
        aria-expanded={open}
        onClick={() => {
          setOpen(value => !value)
          if (!open) void refresh()
        }}
      >
        <IconClockOutline16 size={props.wide ? 16 : 18} />
        {props.wide && (
          <>
            <span className="dsh-opj_ovLabel">{t('overviewTrigger')}</span>
            <span
              className="dsh-opj_ovCount"
              {...(badgeCount > 0 ? { 'data-attention': '' } : {})}
            >
              {badgeCount}
            </span>
          </>
        )}
      </button>
    </div>
  )
}

function OffpeakOverviewWithTitles(props: {
  wide: boolean
  t?: (key: OffpeakKey, vars?: Record<string, string | number>) => string
  openSession?: (sessionId: string) => void
  useSessions: (selector: (state: any) => unknown) => unknown
}) {
  const titles = props.useSessions((state: any) => {
    const byId = state?.byId
    if (byId === null || typeof byId !== 'object') return {} as Record<string, string>
    const out: Record<string, string> = {}
    for (const [id, row] of Object.entries(byId as Record<string, any>)) {
      const title = typeof row?.displayTitle === 'string'
        ? row.displayTitle
        : typeof row?.title === 'string' ? row.title : undefined
      if (title) out[id] = title
    }
    return out
  }) as Record<string, string>
  return <OffpeakOverviewInner {...props} titles={titles} />
}

export function OffpeakOverviewEntry(props: {
  wide: boolean
  t?: (key: OffpeakKey, vars?: Record<string, string | number>) => string
  openSession?: (sessionId: string) => void
  useSessions?: (selector: (state: any) => unknown) => unknown
}) {
  if (typeof props.useSessions === 'function') {
    return (
      <OffpeakOverviewWithTitles
        wide={props.wide}
        t={props.t}
        openSession={props.openSession}
        useSessions={props.useSessions}
      />
    )
  }
  return <OffpeakOverviewInner {...props} titles={{}} />
}
