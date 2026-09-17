/**
 * Synthetic follow-up used after a window-end pause so the next idle window
 * can open a new turn against the existing transcript.
 */

import { randomUUID } from 'node:crypto'

/** Model-facing resume prompt (English; WaitDock uses locale for the row label). */
export const RESUME_PROMPT_TEXT =
  'The previous turn was paused because the off-peak (idle) window ended. '
  + 'Please continue the unfinished task from where it left off.'

/**
 * Build a minimal user message the agent inbox / followup path accepts.
 * Avoids a hard dependency on `@deepseek-ai/dsh-llm` inside this plugin bundle.
 *
 * @returns a followup-ready user message
 */
export function createResumeUserMessage(): {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'plugin'; plugin: string; form: 'notice'; summary: string }
} {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: RESUME_PROMPT_TEXT }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-offpeak-job',
      form: 'notice',
      summary: 'Off-peak window ended; resume',
    },
  }
}
