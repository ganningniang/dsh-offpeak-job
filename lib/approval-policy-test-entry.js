// src/approval-policy.ts
var DEFAULT_OFFPEAK_APPROVAL_POLICY = "reject";
function parseOffpeakApprovalPolicy(value) {
  if (value === "reject" || value === "wait" || value === "allow") return value;
  return void 0;
}
function resolveOffpeakApprovalPolicy(value) {
  return parseOffpeakApprovalPolicy(value) ?? DEFAULT_OFFPEAK_APPROVAL_POLICY;
}
export {
  DEFAULT_OFFPEAK_APPROVAL_POLICY,
  parseOffpeakApprovalPolicy,
  resolveOffpeakApprovalPolicy
};
