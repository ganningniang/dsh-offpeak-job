/**
 * Recognize {@link @deepseek-ai/dsh-tool-jobs} background completion notices.
 * These are model-facing plugin messages, not user-authored queue items.
 */

/** @returns true when `message` is a tool-jobs completion notice. */
export function isJobCompletionNotice(message: unknown): boolean {
  const source = (message as { source?: unknown } | null)?.source
  if (source === null || typeof source !== 'object') return false
  const tagged = source as { kind?: unknown; plugin?: unknown; form?: unknown }
  return tagged.kind === 'plugin'
    && tagged.plugin === 'tool-jobs'
    && tagged.form === 'notice'
}
