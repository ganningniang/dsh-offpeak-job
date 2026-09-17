/**
 * Off-peak tool-approval policy for unattended 谷时 runs.
 * Provider `defaultApprovalPolicy` is authoritative; session fields are ignored.
 */

/** How the plugin answers `approval/request` during Off-peak run. */
export type OffpeakApprovalPolicy = 'reject' | 'wait' | 'allow'

export const DEFAULT_OFFPEAK_APPROVAL_POLICY: OffpeakApprovalPolicy = 'reject'

/**
 * @param value - raw config / API value.
 * @returns a closed policy, or undefined when absent/invalid.
 */
export function parseOffpeakApprovalPolicy(value: unknown): OffpeakApprovalPolicy | undefined {
  if (value === 'reject' || value === 'wait' || value === 'allow') return value
  return undefined
}

/**
 * @param value - raw config / API value.
 * @returns a closed policy (defaults to {@link DEFAULT_OFFPEAK_APPROVAL_POLICY}).
 */
export function resolveOffpeakApprovalPolicy(value: unknown): OffpeakApprovalPolicy {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY
}
