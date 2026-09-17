/**
 * Resolve the LLM provider route for the agent about to run a step.
 */

import { DEEPSEEK_OFFICIAL_PROVIDER } from './types.ts'

/**
 * Best-effort provider id for deferral.
 * Prefers live model selection, then last request header, then the default model.
 * @param agent - pre-step agent payload
 * @param ctx - Cordis context (may expose agentDefaultModel / apiSession)
 * @returns provider route id (falls back to deepseek-official)
 */
export function resolveSessionProvider(agent: any, ctx: any): string {
  try {
    const api = ctx?.apiSession
    const live = api?.selectionFor?.(agent)?.current
    if (typeof live?.provider === 'string' && live.provider.length > 0) return live.provider
  } catch {
    // optional service
  }

  try {
    const header = agent?.session?.requestHeader?.()
    const provider = header?.config?.provider
    if (typeof provider === 'string' && provider.length > 0) return provider
  } catch {
    // session shape varies
  }

  try {
    const events = agent?.session?.events
    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev?.type === 'model/selection' && typeof ev.data?.provider === 'string') {
          return ev.data.provider
        }
        if (ev?.type === 'request/header' && typeof ev.data?.header?.config?.provider === 'string') {
          return ev.data.header.config.provider
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const sel = ctx?.agentDefaultModel?.currentSelection?.()
    if (typeof sel?.provider === 'string' && sel.provider.length > 0) return sel.provider
  } catch {
    // ignore
  }

  return DEEPSEEK_OFFICIAL_PROVIDER
}
